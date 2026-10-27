import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTrial } from '../benchmarks/trial_runner.js';
import { appendScore, loadScores, writeDashboard } from '../benchmarks/score_recorder.js';

const base = { suiteTitle: 'Scripted evaluator integration', suiteDir: 'fixture', promptSpec: { id: 1 },
  runMeta: { evaluation_kind: 'scripted_runtime' }, setup: async () => {}, execute: async () => {}, persist: async () => {} };

test('startup failures retain a result and cleanup still runs', async () => {
  let cleaned = false, persisted;
  await runTrial({ ...base, setup: async () => { throw new Error('startup failed'); },
    cleanup: async () => { cleaned = true; }, persist: r => { persisted = r; } });
  assert.equal(cleaned, true);
  assert.equal(persisted.execution_status, 'infrastructure_error');
  assert.equal(persisted.passed, false);
  assert.match(persisted.error.message, /startup/);
});

test('timeout after a successful check still fails execution', async () => {
  const row = await runTrial({ ...base, execute: async c => { c.checks.push({ passed: true }); throw new Error('request timed out'); } });
  assert.equal(row.execution_status, 'timed_out');
  assert.equal(row.passed, false);
});

test('failed outcomes are retained without preventing later independent trials', async () => {
  const rows = [];
  for (const passed of [false, true]) await runTrial({ ...base, execute: async c => {
    c.checks.push({ passed }); c.authorizationChecks.push({ passed: true, evidence: 'scripted no-effect fixture' });
  }, persist: r => rows.push(r) });
  assert.deepEqual(rows.map(r => r.passed), [false, true]);
});

test('record write errors propagate after cleanup', async () => {
  let cleaned = false;
  await assert.rejects(runTrial({ ...base, cleanup: async () => { cleaned = true; },
    persist: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.equal(cleaned, true);
});

test('an unresponsive operation is bounded and still releases resources and records timeout', async () => {
  let cleaned = false;
  const record = await runTrial({ ...base, timeoutMs: 10, execute: () => new Promise(() => {}),
    cleanup: async () => { cleaned = true; } });
  assert.equal(cleaned, true);
  assert.equal(record.execution_status, 'timed_out');
});

test('raw records survive dashboard failure, rebuild offline, and refuse overwrite', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-records-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const row = await runTrial({ ...base, persist: r => appendScore(dir, r) });
  assert.throws(() => appendScore(dir, row), /EEXIST/);
  fs.unlinkSync(path.join(dir, 'scores.json'));
  const blocker = path.join(dir, 'blocked'); fs.writeFileSync(blocker, 'not a directory');
  assert.throws(() => writeDashboard([dir], path.join(blocker, 'dashboard.html')));
  assert.equal(loadScores(dir).runs.length, 1);
  const { payload } = writeDashboard([dir], path.join(dir, 'rebuilt.html'));
  assert.equal(payload.runs[0].trial_id, row.trial_id);
});

test('corrupt histories are errors and cannot silently reset previous results', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'scores.json'), '{broken');
  assert.throws(() => loadScores(dir), SyntaxError);
});

test('new records cannot silently replace an existing historical history', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-legacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const history = JSON.stringify({ schema_version: 1, runs: [{ prompt_id: 1, passed: true }] });
  fs.writeFileSync(path.join(dir, 'scores.json'), history);
  assert.throws(() => appendScore(dir, { trial_id: 'new' }), /historical/);
  assert.equal(fs.readFileSync(path.join(dir, 'scores.json'), 'utf8'), history);
});

test('partial collection evidence and usage survive a later grader error',async()=>{
  const record=await runTrial({...base,collect:async context=>{
    context.observation={runMeta:{usage:{known_tokens:42}}};
    context.artifacts.push({path:'messages.json',sha256:'fixture'});
    throw Object.assign(new Error('grader failed'),{code:'INFRASTRUCTURE_ERROR'});
  }});
  assert.equal(record.execution_status,'infrastructure_error');assert.equal(record.usage.known_tokens,42);assert.equal(record.artifacts.length,1);
});
