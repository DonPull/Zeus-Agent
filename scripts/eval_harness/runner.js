import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverSpec, readJson, resolveBenchmarkConfig, selectPrompts, fingerprint, environmentOverrides } from '../../tests/benchmarks/benchmark_config.js';
import { appendScore, atomicWrite, buildScoreRecord, loadScores, writeDashboard } from '../../tests/benchmarks/score_recorder.js';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const suiteNames = { wave1: 'wave_1_foundation', wave2: 'wave_2_browser_agentics',
  gaia: 'official_gaia_mini', swe: 'official_swe_mini' }; // Directory names preserve history; contents are synthetic.

export function parseArgs(args, env = process.env) {
  const inherited = environmentOverrides(env);
  const options = { profile: inherited.profile ?? 'standard', suite: 'all', architecture: inherited.architecture ?? 'solo',
    trials: 1, live: env.ZEUS_ALLOW_LIVE_EVAL === '1', overrides: inherited, supervised: false };
  const fields = { '--profile': 'profile', '--suite': 'suite', '--arch': 'architecture', '--output': 'output',
    '--trials': 'trials', '--suite-dir': 'suiteDir', '--matrix-config': 'matrixConfig', '--grep': 'grep', '-g': 'grep' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (fields[arg] || arg === '--model') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--model') options.overrides.master_model = value;
      else options[fields[arg]] = value;
    } else if (arg === '--live') options.live = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--supervised' || arg === '-s') options.supervised = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.trials = Number(options.trials);
  if (!Number.isSafeInteger(options.trials) || options.trials < 1 || options.trials > 100) throw new Error('trials must be an integer from 1 to 100');
  resolveBenchmarkConfig({ cli: { ...options.overrides, profile: options.profile, architecture: options.architecture } });
  if (options.grep) new RegExp(options.grep);
  return options;
}

export function sourceBuild(root = repoRoot) {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    const diff = git('diff', '--binary', 'HEAD');
    const untracked = git('ls-files', '--others', '--exclude-standard').trim().split(/\r?\n/).filter(Boolean).sort();
    const files = untracked.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]);
    return { source_commit: git('rev-parse', 'HEAD').trim(), dirty: Boolean(diff || files.length),
      diff_hash: fingerprint({ diff, files }), node: process.version };
  } catch (error) { throw new Error(`Cannot identify evaluated source: ${error.message}`); }
}

export function prepareSuites(options, root = repoRoot) {
  const directories = options.suiteDir ? [path.resolve(root, options.suiteDir)] :
    options.suite === 'all' ? Object.values(suiteNames).map(name => path.join(root, 'tests/benchmarks/suites', name)) :
      suiteNames[options.suite] ? [path.join(root, 'tests/benchmarks/suites', suiteNames[options.suite])] : [];
  if (!directories.length) throw new Error(`Unknown suite: ${options.suite}`);
  const matrixPath = options.matrixConfig ? path.resolve(root, options.matrixConfig) : null;
  const matrix = matrixPath ? readJson(matrixPath) : {};
  return directories.map(dir => {
    const spec = discoverSpec(dir);
    const suite = fs.existsSync(path.join(dir, 'suite_config.json')) ? readJson(path.join(dir, 'suite_config.json')) : {};
    const cli = { ...options.overrides, architecture: options.architecture, profile: options.profile };
    const config = resolveBenchmarkConfig({ suite, profile: matrix, cli });
    const prompts = selectPrompts(readJson(path.join(dir, 'prompts.json')), options.profile)
      .filter(p => !options.grep || new RegExp(options.grep).test(`[Prompt ${p.id}] ${p.title} (${p.name})`));
    if (!prompts.length) throw new Error(`No tasks selected in ${dir}`);
    const configurations = prompts.map(p => resolveBenchmarkConfig({ suite, profile: matrix, cli,
      task: { ...(p.budget_credits !== undefined ? { budget_credits: p.budget_credits } : {}), ...p.config_overrides } }));
    return { dir, spec, config, configurations, prompts, matrix, cli, suite,
      suite_hash: fingerprint({ prompts, config, spec: fs.readFileSync(spec, 'utf8') }) };
  });
}

export function runBenchmarks(options, { root = repoRoot, spawn = spawnSync, identifyBuild = sourceBuild } = {}) {
  const suites = prepareSuites(options, root);
  if (options.dryRun) return { code: 0, manifest: suites.map(s => ({ suite: path.basename(s.dir), spec: s.spec,
    tasks: s.prompts.map((p, i) => ({ id: p.id, configuration: s.configurations[i] })), trials: options.trials })) };
  if (!options.live) throw new Error('Hosted evaluations require --live or ZEUS_ALLOW_LIVE_EVAL=1. Use --dry-run to inspect without model calls.');
  const experiment = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const output = options.output ? path.resolve(root, options.output) : path.join(root, '.zeus/evaluations', experiment);
  fs.mkdirSync(output, { recursive: true });
  if (fs.existsSync(path.join(output, 'experiment.json'))) throw new Error(`Output already contains an experiment: ${output}`);
  const build = identifyBuild(root);
  atomicWrite(path.join(output, 'experiment.json'), JSON.stringify({ experiment_id: experiment, build,
    suites: suites.map(s => ({ dir: s.dir, suite_hash: s.suite_hash, tasks: s.prompts.map(p => p.id) })), options }, null, 2));
  let code = 0;
  const resultDirs = [];
  for (const suite of suites) {
    const resultDir = path.join(output, path.basename(suite.dir));
    resultDirs.push(resultDir);
    const env = { ...process.env, ZEUS_BENCH_EXPERIMENT: experiment, ZEUS_BENCH_RESULTS_DIR: resultDir,
      ZEUS_BENCH_PROFILE: options.profile, ZEUS_BENCH_ARCH: options.architecture, ZEUS_BENCH_MODE: 'score-only',
      ZEUS_BENCH_OVERRIDES: JSON.stringify(suite.cli), ZEUS_BENCH_MATRIX: JSON.stringify(suite.matrix),
      ZEUS_BENCH_SELECTED_IDS: JSON.stringify(suite.prompts.map(p => String(p.id))), ZEUS_BENCH_TRIALS: String(options.trials),
      ZEUS_BENCH_BUILD: JSON.stringify(build), ZEUS_ALLOW_LIVE_EVAL: '1',
      ZEUS_BENCH_SUPERVISED: options.supervised ? '1' : '0', ZEUS_SCORE_ONLY: '1', ZEUS_BENCH_CONTINUE: '1' };
    const child = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', suite.spec,
      '--reporter=list', '--retries=0'], { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true });
    if (child.error || child.status !== 0) code = 1;
    // Startup/collection failures must leave evidence for every requested trial.
    let rows = loadScores(resultDir).runs;
    for (const prompt of suite.prompts) {
      const completed = rows.filter(r => String(r.prompt_id) === String(prompt.id)).length;
      for (let trial = completed; trial < options.trials; trial++) {
        appendScore(resultDir, buildScoreRecord({ suiteTitle: path.basename(suite.dir), suiteDir: suite.dir, promptSpec: prompt,
          runMeta: { experiment_id: experiment, build, architecture: options.architecture,
            configuration: suite.configurations[suite.prompts.indexOf(prompt)], execution_status: 'infrastructure_error',
            termination_reason: child.error?.message ?? `Runner exited ${child.status}; requested trial produced no record` } }));
        code = 1;
      }
    }
    rows = loadScores(resultDir).runs;
    if (rows.some(row => !row.passed)) code = 1;
  }
  const { payload } = writeDashboard(resultDirs, path.join(output, 'index.html'));
  return { code, output, aggregate: payload.aggregate };
}

export function printHelp() {
  console.log('Usage: node scripts/eval_harness/run_benchmark.js [--suite wave1|wave2|gaia|swe|all] [--suite-dir path] [--profile smoke|standard|full] [--arch solo|team] [--model id] [--matrix-config path] [--trials N] [--output path] [-g pattern] [--dry-run | --live] [--supervised]');
  console.log('gaia and swe select local synthetic exercises, not the official public benchmarks. --live may consume hosted credits.');
}
