import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverResultDirs, generateDashboard } from '../../scripts/eval_harness/generate_dashboard.js';
import { appendScore, buildScoreRecord } from '../benchmarks/score_recorder.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-dashboard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('dashboard rebuilds from raw records across experiments without changing them', t => {
  const root = fixture(t), evaluationRoot = path.join(root, '.zeus/evaluations');
  const raw = [];
  for (const experiment of ['old', 'new']) {
    const dir = path.join(evaluationRoot, experiment, 'suite');
    const row = buildScoreRecord({ suiteTitle: 'fixture', suiteDir: 'suite', promptSpec: { id: 1 },
      runMeta: { experiment_id: experiment, status: 'succeeded' }, pythonCheckPassed: experiment === 'new',
      authorizationChecks: [{ passed: true }] });
    appendScore(dir, row);
    raw.push(path.join(dir, 'trials', `${row.trial_id}.json`));
    fs.unlinkSync(path.join(dir, 'scores.json'));
  }
  const before = raw.map(file => fs.readFileSync(file, 'utf8'));
  const { out, payload } = generateDashboard([], root);
  assert.equal(payload.runs.length, 2);
  assert.equal(payload.aggregate.overall.pass_count, 1);
  assert.ok(out.startsWith(evaluationRoot));
  assert.deepEqual(raw.map(file => fs.readFileSync(file, 'utf8')), before);
  assert.equal(discoverResultDirs([evaluationRoot, evaluationRoot]).length, 2);
});

test('missing, empty, or corrupt report inputs fail explicitly without falling back', t => {
  const root = fixture(t);
  assert.throws(() => generateDashboard(['missing'], root), /Missing results/);
  assert.throws(() => discoverResultDirs([root]), /No retained trials/);
  fs.writeFileSync(path.join(root, 'scores.json'), 'broken');
  assert.throws(() => discoverResultDirs([root]), SyntaxError);
});
