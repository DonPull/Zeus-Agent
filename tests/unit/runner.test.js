import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, prepareSuites, runBenchmarks } from '../../scripts/eval_harness/runner.js';
import { appendScore, buildScoreRecord, loadScores } from '../benchmarks/score_recorder.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const suite = path.join(root, 'suite'); fs.mkdirSync(suite);
  fs.writeFileSync(path.join(suite, 'fixture.spec.js'), '// startup target');
  fs.writeFileSync(path.join(suite, 'prompts.json'), JSON.stringify([{ id: 1, name: 'fixture', turns: [{ user_prompt: 'do a thing' }] }]));
  return root;
}

test('CLI rejects unknown options and a missing required value', () => {
  assert.throws(() => parseArgs(['--profiel', 'smoke'], {}), /Unknown argument/);
  assert.throws(() => parseArgs(['--model'], {}), /Missing value/);
  assert.throws(() => parseArgs(['--trials', '0'], {}), /trials/);
});

test('actual existing specs are discovered, including both Wave suites', () => {
  const suites = prepareSuites(parseArgs(['--dry-run'], {}));
  assert.equal(suites.length, 4);
  assert.ok(suites.find(s => s.spec.endsWith('wave_1.spec.js')));
  assert.ok(suites.find(s => s.spec.endsWith('wave_2.spec.js')));
});

test('dry runs cannot spawn model evaluation, and live calls require explicit opt-in', t => {
  const root = fixture(t);
  let spawned = false;
  const options = parseArgs(['--suite-dir', 'suite', '--dry-run'], {});
  assert.equal(runBenchmarks(options, { root, spawn: () => { spawned = true; } }).code, 0);
  assert.equal(spawned, false);
  assert.throws(() => runBenchmarks({ ...options, dryRun: false }, { root }), /require --live/);
});

test('missing suites and empty task selections fail before spawning', t => {
  const root = fixture(t);
  assert.throws(() => runBenchmarks(parseArgs(['--suite-dir', 'missing', '--dry-run'], {}), { root }));
  fs.writeFileSync(path.join(root, 'suite/prompts.json'), '[]');
  assert.throws(() => runBenchmarks(parseArgs(['--suite-dir', 'suite', '--dry-run'], {}), { root }), /No tasks/);
});

test('child startup failures produce infrastructure records and nonzero status', t => {
  const root = fixture(t);
  const result = runBenchmarks(parseArgs(['--suite-dir', 'suite', '--live', '--output', 'results'], {}), {
    root, identifyBuild: () => ({ source_commit: 'fixture' }), spawn: () => ({ status: null, error: new Error('startup failure') }),
  });
  assert.equal(result.code, 1);
  const records = loadScores(path.join(root, 'results/suite')).runs;
  assert.equal(records.length, 1);
  assert.equal(records[0].execution_status, 'infrastructure_error');
  assert.match(records[0].termination_reason, /startup/);
});

test('a zero process exit cannot hide a failed independent task check', t => {
  const root = fixture(t);
  const result = runBenchmarks(parseArgs(['--suite-dir', 'suite', '--live', '--output', 'results'], {}), {
    root, identifyBuild: () => ({ source_commit: 'fixture' }), spawn: (_, __, { env }) => {
      appendScore(env.ZEUS_BENCH_RESULTS_DIR, buildScoreRecord({ suiteTitle: 'fixture', suiteDir: 'suite',
        promptSpec: { id: 1 }, pythonCheckPassed: false,
        runMeta: { status: 'succeeded', experiment_id: env.ZEUS_BENCH_EXPERIMENT } }));
      return { status: 0 };
    },
  });
  assert.equal(result.code, 1);
});
