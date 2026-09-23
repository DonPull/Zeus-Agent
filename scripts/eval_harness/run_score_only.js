#!/usr/bin/env node
/**
 * Score-only benchmark helper for Zeus Agent.
 *
 * Usage:
 *   node scripts/eval_harness/run_score_only.js <suite_dir> [playwright args...]
 *   node scripts/eval_harness/run_score_only.js tests/benchmarks/suites/wave_1_foundation
 *   node scripts/eval_harness/run_score_only.js tests/benchmarks/suites/wave_1_foundation -g "Prompt 1"
 *
 * Env:
 *   ZEUS_SCORE_ONLY=1     record failures without aborting the suite (set automatically)
 *   ZEUS_BENCH_MODE=score-only
 *   ZEUS_BENCH_ARCH=solo|team   architecture label for the dashboard
 *
 * Does NOT patch Zeus Agent source. For continuous-improvement fix loops, use
 * the skill workflow separately (score-and-fix).
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { collectDashboardData, writeDashboard } from '../../tests/benchmarks/score_recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function usage() {
  console.log(`Usage: node scripts/eval_harness/run_score_only.js <suite_dir> [playwright args...]

Examples:
  node scripts/eval_harness/run_score_only.js tests/benchmarks/suites/wave_1_foundation
  node scripts/eval_harness/run_score_only.js tests/benchmarks/suites/wave_1_foundation -g "Prompt 1"

Env:
  ZEUS_BENCH_ARCH=solo|team   label architecture on the dashboard
`);
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  const suiteArg = args[0];
  const playwrightArgs = args.slice(1);
  const suiteDir = path.isAbsolute(suiteArg) ? suiteArg : path.join(repoRoot, suiteArg);

  if (!fs.existsSync(suiteDir)) {
    console.error(`Suite directory not found: ${suiteDir}`);
    process.exit(1);
  }

  // Prefer wave_*.spec.js inside the suite; fall back to directory as a playwright target.
  const specCandidates = fs
    .readdirSync(suiteDir)
    .filter((f) => f.endsWith('.spec.js'))
    .map((f) => path.join(suiteDir, f));
  const specTarget = specCandidates[0] || suiteDir;

  const env = {
    ...process.env,
    ZEUS_SCORE_ONLY: '1',
    ZEUS_BENCH_MODE: 'score-only',
    ZEUS_BENCH_ARCH: process.env.ZEUS_BENCH_ARCH || process.env.ZEUS_BENCH_MODE || 'team',
  };

  console.log(`\n🎯 [SCORE-ONLY] Suite: ${suiteDir}`);
  console.log(`🎯 [SCORE-ONLY] Architecture label: ${env.ZEUS_BENCH_ARCH}`);
  console.log(`🎯 [SCORE-ONLY] Spec: ${specTarget}`);
  if (playwrightArgs.length) console.log(`🎯 [SCORE-ONLY] Extra args: ${playwrightArgs.join(' ')}\n`);

  const result = spawnSync(
    'npx',
    ['playwright', 'test', specTarget, '--reporter=list', ...playwrightArgs],
    {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }
  );

  // Always emit / refresh dashboard from recorded scores.
  try {
    const { out } = writeDashboard([suiteDir], path.join(suiteDir, 'scores_dashboard.html'));
    const payload = collectDashboardData([suiteDir]);
    const agg = payload.aggregate;
    console.log(`\n📈 [SCORE-ONLY] Dashboard: ${out}`);
    console.log(
      `📈 [SCORE-ONLY] Pass rate ${Math.round((agg.pass_rate || 0) * 100)}% · ` +
      `avg total ${agg.overall.avg_total} · prompts ${agg.prompt_count || 0}`
    );
    console.log(`📈 [SCORE-ONLY] Categories: ${Object.keys(agg.by_category || {}).join(', ') || '(none)'}`);
  } catch (e) {
    console.warn('[SCORE-ONLY] Dashboard generation failed:', e.message);
  }

  process.exit(result.status ?? 1);
}

main();
