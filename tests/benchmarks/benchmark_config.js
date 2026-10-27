import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROLES = ['master', 'worker', 'verifier', 'watcher', 'vision'];
export const DEFAULTS = Object.freeze({ architecture: 'solo', profile: 'standard', default_model: 'route-llm',
  budget_credits: 50000, browser_mode: 'sandboxed', prompt_timeout_ms: 900000,
  turn_timeout_ms: 600000, permission_policy: 'legacy-eval-with-user-simulator' });

export function fingerprint(value) {
  const stable = item => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, stable(item[k])])) : item;
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function environmentOverrides(env = process.env) {
  const result = {};
  if (env.ZEUS_BENCH_ARCH) result.architecture = env.ZEUS_BENCH_ARCH;
  if (env.ZEUS_BENCH_PROFILE) result.profile = env.ZEUS_BENCH_PROFILE;
  if (env.ZEUS_BENCHMARK_MODEL) result.master_model = env.ZEUS_BENCHMARK_MODEL;
  for (const role of ROLES) {
    if (env[`ZEUS_BENCH_${role.toUpperCase()}_MODEL`] !== undefined) result[`${role}_model`] = env[`ZEUS_BENCH_${role.toUpperCase()}_MODEL`];
  }
  if (env.ZEUS_BENCH_OVERRIDES) Object.assign(result, JSON.parse(env.ZEUS_BENCH_OVERRIDES));
  return result;
}

export function resolveBenchmarkConfig({ defaults = {}, suite = {}, profile = {}, cli = {}, task = {} } = {}) {
  const config = { ...DEFAULTS, ...defaults, ...suite, ...profile, ...cli, ...task };
  if (!['solo', 'team'].includes(config.architecture)) throw new Error(`Invalid architecture: ${config.architecture}`);
  if (!['smoke', 'standard', 'full'].includes(config.profile)) throw new Error(`Invalid profile: ${config.profile}`);
  if (!['legacy-eval-with-user-simulator', 'scripted-no-tools-offline', 'normal-approvals-fixture-v1'].includes(config.permission_policy)) {
    throw new Error(`Unsupported permission policy: ${config.permission_policy}`);
  }
  for (const key of ['budget_credits', 'prompt_timeout_ms', 'turn_timeout_ms']) {
    if (!Number.isFinite(Number(config[key])) || Number(config[key]) <= 0) throw new Error(`${key} must be positive and finite`);
    config[key] = Number(config[key]);
  }
  config.roles = {};
  for (const role of ROLES) {
    if (config[`${role}_provider`] && config[`${role}_provider`] !== 'runtime_selected') {
      throw new Error('Provider overrides are not supported by the current runtime; choose a model and record its actual endpoint');
    }
    const model = config[`${role}_model`] ?? (role === 'vision' ? 'None' : config.default_model);
    const enabled = typeof model === 'string' && model.trim() !== '' && model.toLowerCase() !== 'none';
    config.roles[role] = { enabled, model: enabled ? model.trim() : null,
      // The current gateway also has a dynamic local-model registry; the ledger
      // records the actual endpoint. Do not invent provider identity from a name.
      provider: config[`${role}_provider`] ?? 'runtime_selected',
      effort: config[`${role}_effort`] ?? 'default' };
    if (!['default', 'low', 'medium', 'high'].includes(config.roles[role].effort)) throw new Error(`Invalid ${role} effort`);
  }
  if (!config.roles.master.enabled) throw new Error('The master role must be enabled');
  if (config.architecture === 'solo') {
    for (const role of ['worker', 'verifier']) config.roles[role] = { ...config.roles[role], enabled: false, model: null };
  } else if (!config.roles.worker.enabled || !config.roles.verifier.enabled) throw new Error('Team requires worker and verifier models');
  for (const role of ROLES) {
    config[`${role}_model`] = config.roles[role].enabled ? config.roles[role].model : 'None';
    config[`${role}_effort`] = config.roles[role].effort;
  }
  // Watcher authorization is independent of Solo/Team collaboration.
  config.configuration_fingerprint = fingerprint({ architecture: config.architecture, roles: config.roles,
    budget_credits: config.budget_credits, browser_mode: config.browser_mode, permission_policy: config.permission_policy,
    turn_timeout_ms: config.turn_timeout_ms, prompt_timeout_ms: config.prompt_timeout_ms,
    execution_profile:config.execution_profile,evaluation_limits:config.evaluation_limits });
  return config;
}

export function taskSettings(config) {
  const settings = { budget_credits: config.budget_credits, browser_mode: config.browser_mode };
  for (const role of ROLES) {
    settings[`${role}_model`] = config.roles[role].enabled ? config.roles[role].model : 'None';
    settings[`${role}_effort`] = config.roles[role].effort;
  }
  return settings;
}

export function assertEffectiveSettings(expected, actual) {
  if (!actual) throw new Error('Task configuration could not be read back');
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) throw new Error(`Effective setting mismatch: ${key}; expected ${value}, received ${actual[key]}`);
  }
}

export function selectPrompts(prompts, profile) {
  if (!Array.isArray(prompts)) throw new Error('prompts.json must contain an array');
  if (!['smoke', 'standard', 'full'].includes(profile)) throw new Error(`Invalid profile: ${profile}`);
  const selected = prompts.filter(p => profile === 'full' || (profile === 'smoke'
    ? p.profile === 'smoke' || String(p.id) === '1' : p.profile !== 'full_only'));
  if (!selected.length) throw new Error('No tasks selected');
  const ids = new Set();
  for (const p of selected) {
    if (p.id == null || ids.has(String(p.id))) throw new Error('Missing or duplicate task ID');
    ids.add(String(p.id));
    if (!p.turns?.length || p.turns.some(t => typeof t.user_prompt !== 'string')) throw new Error(`Task ${p.id} has no valid turns`);
  }
  return selected;
}

export function discoverSpec(dir) {
  const specs = fs.readdirSync(dir).filter(name => name.endsWith('.spec.js')).sort();
  if (specs.length !== 1) throw new Error(`Expected exactly one benchmark spec in ${dir}, found ${specs.length}`);
  if (!fs.existsSync(path.join(dir, 'prompts.json'))) throw new Error(`Missing prompts.json in ${dir}`);
  return path.join(dir, specs[0]);
}
