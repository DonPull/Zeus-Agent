import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBenchmarkConfig, taskSettings, assertEffectiveSettings, selectPrompts, fingerprint } from '../benchmarks/benchmark_config.js';

test('configuration precedence and Solo role disablement reach actual task fields', () => {
  const config = resolveBenchmarkConfig({ suite: { master_model: 'suite', worker_model: 'worker' },
    profile: { master_model: 'matrix' }, cli: { master_model: 'cli', architecture: 'solo' }, task: { budget_credits: 123 } });
  const fields = taskSettings(config);
  assert.equal(fields.master_model, 'cli');
  assert.equal(fields.worker_model, 'None');
  assert.equal(fields.verifier_model, 'None');
  assert.equal(fields.budget_credits, 123);
  assertEffectiveSettings(fields, fields);
  assert.throws(() => assertEffectiveSettings(fields, { ...fields, worker_model: 'still enabled' }), /mismatch/);
});

test('invalid profiles, budgets, and incomplete Team configurations fail early', () => {
  assert.throws(() => resolveBenchmarkConfig({ cli: { profile: 'smkoe' } }), /Invalid profile/);
  assert.throws(() => resolveBenchmarkConfig({ task: { budget_credits: 0 } }), /positive/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { architecture: 'team', worker_model: 'None' } }), /Team requires/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { master_provider: 'imaginary' } }), /Provider overrides/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { permission_policy: 'imaginary' } }), /Unsupported permission/);
});

test('empty selections and duplicate IDs are errors, not empty successful suites', () => {
  assert.throws(() => selectPrompts([], 'smoke'), /No tasks/);
  const prompt = { id: 1, turns: [{ user_prompt: 'test' }] };
  assert.throws(() => selectPrompts([prompt, prompt], 'full'), /duplicate/);
});

test('fingerprints ignore property ordering and include changes to policy and roles', () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(resolveBenchmarkConfig().configuration_fingerprint,
    resolveBenchmarkConfig({ cli: { permission_policy: 'scripted-no-tools-offline' } }).configuration_fingerprint);
});
