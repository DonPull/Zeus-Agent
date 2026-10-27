import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { launchTauri, stopTauri, startMockServer, stopMockServer, queueMockResponse } from '../e2e/testUtils.js';
import { submitPromptAndWait } from '../advanced_e2e/advancedUtils.js';
import { environmentOverrides, resolveBenchmarkConfig, taskSettings, assertEffectiveSettings, selectPrompts, readJson, fingerprint } from './benchmark_config.js';
import { appendScore, writeDashboard, checkGaiaAnswer, atomicWrite } from './score_recorder.js';
import { runTrial } from './trial_runner.js';

export function fixtureHash(dir) {
  if (!fs.existsSync(dir)) return fingerprint([]);
  const visit = (root, relative = '') => fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(root, entry.name), rel = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Benchmark fixtures must not contain symbolic links');
    return entry.isDirectory() ? visit(file, rel) : [[rel, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
  });
  return fingerprint(visit(dir));
}

export function registerBenchmarkSuite(suiteTitle, suiteDir) {
  if (process.env.ZEUS_ALLOW_LIVE_EVAL !== '1' && process.env.ZEUS_OFFLINE_TEST !== '1') {
    throw new Error('Benchmark execution needs ZEUS_ALLOW_LIVE_EVAL=1 or explicit offline mode');
  }
  const suiteFile = path.join(suiteDir, 'suite_config.json');
  const suite = fs.existsSync(suiteFile) ? readJson(suiteFile) : {};
  const matrix = JSON.parse(process.env.ZEUS_BENCH_MATRIX ?? '{}');
  const cli = environmentOverrides();
  const initial = resolveBenchmarkConfig({ suite, profile: matrix, cli });
  const offline = process.env.ZEUS_OFFLINE_TEST === '1';
  const expectedPolicy = offline ? 'scripted-no-tools-offline' : 'legacy-eval-with-user-simulator';
  if (initial.permission_policy !== expectedPolicy) throw new Error(`Unsupported runtime permission policy: ${initial.permission_policy}`);
  const selectedIds = process.env.ZEUS_BENCH_SELECTED_IDS ? JSON.parse(process.env.ZEUS_BENCH_SELECTED_IDS) : null;
  const prompts = selectPrompts(readJson(path.join(suiteDir, 'prompts.json')), initial.profile)
    .filter(p => !selectedIds || selectedIds.includes(String(p.id)));
  if (!prompts.length) throw new Error('No tasks selected');
  const repetitions = Number(process.env.ZEUS_BENCH_TRIALS ?? 1);
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('Invalid trial count');
  const experiment = process.env.ZEUS_BENCH_EXPERIMENT ?? crypto.randomUUID();
  const resultDir = process.env.ZEUS_BENCH_RESULTS_DIR ?? path.resolve('.zeus/evaluations', experiment, path.basename(suiteDir));

  test.describe(suiteTitle, () => {
    test.describe.configure({ mode: 'default', retries: 0 });
    for (const prompt of prompts) for (let repetition = 0; repetition < repetitions; repetition++) {
      const config = resolveBenchmarkConfig({ suite, profile: matrix, cli,
        task: { ...(prompt.budget_credits !== undefined ? { budget_credits: prompt.budget_credits } : {}), ...prompt.config_overrides } });
      if (config.permission_policy !== expectedPolicy) throw new Error(`Unsupported runtime permission policy: ${config.permission_policy}`);
      test(`[Prompt ${prompt.id}] ${prompt.title} (${prompt.name}) trial ${repetition + 1}`, async ({}, testInfo) => {
        test.setTimeout(config.prompt_timeout_ms + 45000); // Leave bounded time for cancellation and record finalization.
        const settings = taskSettings(config);
        const record = await runTrial({ suiteTitle, suiteDir, promptSpec: prompt, timeoutMs: config.prompt_timeout_ms,
          runMeta: { experiment_id: experiment, configuration: config, configuration_fingerprint: config.configuration_fingerprint,
            architecture: config.architecture, suite_version: fingerprint(readJson(path.join(suiteDir, 'prompts.json'))),
            fixture_hash: fixtureHash(path.join(suiteDir, 'fixtures')), build: JSON.parse(process.env.ZEUS_BENCH_BUILD ?? 'null'),
            evaluation_kind: offline ? 'scripted_runtime' : 'capability' },
          setup: async context => {
            if (offline) await startMockServer();
            const { page } = await launchTauri(!offline);
            context.page = page;
            await expect(page.locator('#app-container')).toBeVisible({ timeout: 15000 });
            context.task = await page.evaluate(async () => window.__ZEUS_BRIDGE__.createTask('Benchmark trial'));
            const tid = context.task.id;
            await page.evaluate(({ tid, settings }) => window.__ZEUS_BRIDGE__.updateTaskSettings(tid, settings), { tid, settings });
            const actual = await page.evaluate(async tid => (await window.__ZEUS_BRIDGE__.listTasks()).find(t => t.id === tid), tid);
            assertEffectiveSettings(settings, actual);
            const root = process.env.ZEUS_TEST_WORKSPACE_ROOT;
            if (!root) throw new Error('Test workspace was not initialized; refusing manual app-data fallback');
            context.workspace = path.join(root, 'tasks', tid, 'workspace');
            fs.mkdirSync(context.workspace, { recursive: true });
            const fixtures = path.join(suiteDir, 'fixtures');
            if (fs.existsSync(fixtures)) fs.cpSync(fixtures, context.workspace, { recursive: true, errorOnExist: true, force: false });
            const deploy = path.join(suiteDir, 'deploy_fixtures.js');
            if (fs.existsSync(deploy)) {
              const child = spawnSync(process.execPath, [deploy, '--dest', context.workspace], { timeout: 30000, windowsHide: true });
              if (child.error || child.status !== 0) throw new Error('Fixture deployment failed');
            }
          },
          execute: async context => {
            for (const turn of prompt.turns) {
              if (offline) {
                if (!turn.mock_responses?.length) throw new Error('Offline tasks require explicit mock responses');
                for (const response of turn.mock_responses) queueMockResponse(response);
              }
              await context.page.evaluate(tid => { window.__ZEUS_BENCH_ACTIVE_TASK__ = tid; }, context.task.id);
              if (offline) {
                await context.page.evaluate(async ({ tid, content }) => window.__ZEUS_BRIDGE__.sendUserMessage(tid, content, crypto.randomUUID()),
                  { tid: context.task.id, content: turn.user_prompt });
              } else {
                await context.page.locator(`[data-task-id="${context.task.id}"]`).first().click().catch(() => {});
                await submitPromptAndWait(context.page, turn.user_prompt, testInfo, config.turn_timeout_ms);
              }
              const messages = await context.page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), context.task.id);
              const run = await context.page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskRunState(tid), context.task.id);
              if (run && run.status !== 'completed') throw new Error(`Agent run ended with ${run.status}`);
              if (turn.python_check) {
                // Keep grader source outside the agent workspace, bound execution, and disable assert stripping.
                const childEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
                delete childEnv.PYTHONOPTIMIZE;
                const checked = spawnSync('python', ['-c', turn.python_check], { cwd: context.workspace, encoding: 'utf8',
                  env: childEnv, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
                if (checked.error) throw checked.error;
                context.checks.push({ turn: turn.turn, grader: 'python', passed: checked.status === 0,
                  evidence: { exit_code: checked.status, stdout: checked.stdout, stderr: checked.stderr } });
              }
              if (turn.ground_truth !== undefined) {
                const answer = messages.filter(m => m.role === 'assistant' && m.visible && m.kind === 'chat').at(-1)?.content ?? '';
                context.checks.push({ turn: turn.turn, grader: 'exact-answer', ...checkGaiaAnswer(answer, turn.ground_truth, turn.answer_options) });
              }
              // Only a narrowly defined, independently checked scripted policy can establish authorization here.
              // Live policy evaluation requires explicit graders; absence stays unmeasured.
              if (offline && prompt.authorization_policy === 'no-tools' && messages.every(m =>
                m.role !== 'tool' && !['directive', 'directive_result', 'action', 'approval'].includes(m.kind))) {
                context.authorizationChecks.push({ passed: true, evidence: 'Runtime journal contains no tool, action, or approval messages' });
              }
            }
          },
          collect: async context => {
            if (!context.page || !context.task) return {};
            const messages = await context.page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskMessages(tid, true), context.task.id);
            const spend = await context.page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskSpend(tid), context.task.id);
            const run = await context.page.evaluate(tid => window.__ZEUS_BRIDGE__.getTaskRunState(tid), context.task.id);
            const artifactsDir = path.join(resultDir, 'artifacts', testInfo.testId.replace(/[^\w-]/g, '_'));
            fs.mkdirSync(artifactsDir, { recursive: true });
            const journal = path.join(artifactsDir, 'messages.json');
            atomicWrite(journal, JSON.stringify(messages, null, 2));
            context.artifacts.push({ path: path.relative(resultDir, journal), sha256: fingerprint(messages) });
            const image = path.join(artifactsDir, 'desktop.png');
            await context.page.screenshot({ path: image });
            context.artifacts.push({ path: path.relative(resultDir, image), sha256: crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex') });
            return { unitsUsed: spend.usage?.unknown_requests === 0 ? spend.spent_credits : null, messageCount: messages.length,
              modelsUsed: [...new Set(messages.map(m => m.model).filter(Boolean))], runMeta: { task_id: context.task.id, run_id: run?.id ?? null, usage: spend.usage ?? null } };
          },
          cleanup: async context => {
            try {
              if (context.page && context.task) await context.page.evaluate(async tid => {
                const run = await window.__ZEUS_BRIDGE__.getTaskRunState(tid);
                if (run && ['running', 'stopping'].includes(run.status)) {
                  try { await window.__ZEUS_BRIDGE__.cancelTaskRun(tid); }
                  catch (error) { if (!String(error).includes('TASK_NOT_RUNNING')) throw error; }
                }
              }, context.task.id);
            } finally { await stopTauri(); if (offline) await stopMockServer(); }
          },
          persist: row => appendScore(resultDir, row),
        });
        writeDashboard([resultDir], path.join(resultDir, 'index.html'));
        expect(record.execution_status, JSON.stringify(record.error)).toBe('succeeded');
        expect(record.outcome_status, 'No check is not a passed benchmark').toBe('passed');
        expect(record.authorization_status, 'Authorization was not independently evaluated').toBe('passed');
      });
    }
  });
}
