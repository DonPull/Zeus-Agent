#!/usr/bin/env node
/**
 * Architecture A/B matrix runner (score-only).
 *
 * Usage:
 *   node scripts/eval_harness/run_matrix.js tests/benchmarks/suites/wave_1_foundation
 *   node scripts/eval_harness/run_matrix.js tests/benchmarks/suites/wave_1_foundation -g "Prompt 1"
 *
 * Runs the suite twice:
 *   1) ZEUS_BENCH_ARCH=team  (Master/Worker/Verifier, multi-agent)
 *   2) ZEUS_BENCH_ARCH=solo  (unified single master)
 * then writes a combined dashboard comparing architectures.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { writeDashboard, collectDashboardData } from '../../tests/benchmarks/score_recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function runCell(suiteDir, arch, extraArgs) {
  const env = {
    ...process.env,
    ZEUS_SCORE_ONLY: '1',
    ZEUS_BENCH_MODE: 'score-only',
    ZEUS_BENCH_ARCH: arch,
  };
  const overlay = path.join(
    repoRoot,
    'tests',
    'benchmarks',
    'matrix',
    `${arch}_cloud.suite_config.json`
  );
  if (fs.existsSync(overlay)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(overlay, 'utf8'));
      if (cfg.master_model) env.ZEUS_BENCHMARK_MODEL = cfg.master_model;
    } catch (_) {}
  }

  const runner = path.join(repoRoot, 'scripts', 'eval_harness', 'run_score_only.js');
  console.log(`\n=== MATRIX CELL arch=${arch} ===`);
  const res = spawnSync(process.execPath, [runner, suiteDir, ...extraArgs], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return res.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/eval_harness/run_matrix.js <suite_dir> [playwright args...]');
    process.exit(1);
  }
  const suiteDir = path.resolve(args[0]);
  const extra = args.slice(1);

  const codes = {};
  codes.team = runCell(suiteDir, 'team', extra);
  codes.solo = runCell(suiteDir, 'solo', extra);

  const out = path.join(suiteDir, 'scores_dashboard.html');
  writeDashboard([suiteDir], out);
  const data = collectDashboardData([suiteDir]);
  console.log('\n=== MATRIX ARCHITECTURE COMPARISON ===');
  for (const [arch, agg] of Object.entries(data.aggregate.by_architecture || {})) {
    console.log(
      `  ${arch}: avg_total=${agg.avg_total} pass=${agg.pass_count}/${agg.count} avg_units=${agg.avg_units}`
    );
  }
  console.log(`Dashboard: ${out}`);
  console.log(`Exit codes: team=${codes.team} solo=${codes.solo}`);
  process.exit(codes.team || codes.solo ? 1 : 0);
}

main();
