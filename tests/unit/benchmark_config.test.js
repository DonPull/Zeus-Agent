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
  assert.throws(() => resolveBenchmarkConfig({ cli: { master_provider: 'imaginary' } }), /Unsupported provider/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { permission_policy: 'imaginary' } }), /Unsupported permission/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { image_delivery: 'silent_drop' } }), /Invalid image delivery/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { master_protocol: 'imaginary' } }), /Invalid master protocol/);
  assert.throws(() => resolveBenchmarkConfig({ cli: { master_image_input: 'guess' } }), /Invalid master image capability/);
});

test('identical model IDs on different connections have distinct effective bindings and fingerprints',()=>{
  const hosted=resolveBenchmarkConfig({cli:{master_model:'same-id',master_provider:'abacus'}});
  const local=resolveBenchmarkConfig({cli:{master_model:'same-id',master_provider:'local'}});
  assert.notEqual(hosted.configuration_fingerprint,local.configuration_fingerprint);
  assert.equal(taskSettings(hosted).model_bindings.master.connection,'abacus');
  assert.equal(taskSettings(local).model_bindings.master.connection,'local');
  const legacy=taskSettings(resolveBenchmarkConfig({cli:{master_provider:'runtime_selected'}}));
  assert.equal(legacy.model_bindings.master.connection,'legacy');
  assert.equal(legacy.model_bindings.master.source,'legacy');
  assert.throws(()=>assertEffectiveSettings(taskSettings(hosted),taskSettings(local)),/mismatch/);
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
test('browser ownership implementations are explicit distinct benchmark configurations',()=>{
  const legacy=resolveBenchmarkConfig({task:{browser_service:'legacy'}}),managed=resolveBenchmarkConfig();
  assert.notEqual(legacy.configuration_fingerprint,managed.configuration_fingerprint);
  assert.throws(()=>resolveBenchmarkConfig({task:{browser_service:'unknown'}}));
});
