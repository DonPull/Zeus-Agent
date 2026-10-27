#!/usr/bin/env node
/** A deliberately mixed scripted report to validate the evaluator, never a capability score. */
import path from 'node:path';
import crypto from 'node:crypto';
import { runTrial } from '../../tests/benchmarks/trial_runner.js';
import { appendScore, writeDashboard } from '../../tests/benchmarks/score_recorder.js';

const experiment = `scripted-demo-${crypto.randomUUID()}`;
const dir = path.resolve('.zeus/evaluations', experiment);
for (const scenario of ['pass', 'failed-check', 'startup-error', 'timeout', 'ungraded']) {
  await runTrial({ suiteTitle: 'Evaluator demonstration', suiteDir: 'scripted-demo',
    promptSpec: { id: scenario, name: scenario }, runMeta: { experiment_id: experiment, evaluation_kind: 'scripted_runtime' },
    setup: async () => { if (scenario === 'startup-error') throw new Error('Intentional startup failure'); },
    execute: async context => {
      if (scenario === 'timeout') throw new Error('Intentional request timeout');
      if (scenario !== 'ungraded') context.checks.push({ passed: scenario === 'pass', evidence: 'Controlled evaluator fixture' });
      context.authorizationChecks.push({ passed: true, evidence: 'Scripted pure evaluator; no agent tool execution' });
    }, persist: row => appendScore(dir, row) });
}
const { out, payload } = writeDashboard([dir], path.join(dir, 'index.html'));
console.log(JSON.stringify({ report: out, expected_passes: 1, actual_passes: payload.aggregate.overall.pass_count,
  trials: payload.runs.length, warning: 'Scripted evaluator validation; not agent performance' }, null, 2));
if (payload.aggregate.overall.pass_count !== 1) process.exitCode = 1;
