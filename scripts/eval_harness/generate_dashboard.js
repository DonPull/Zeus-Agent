#!/usr/bin/env node
/**
 * Generate (or refresh) the Zeus Agent benchmark score dashboard.
 *
 * Usage:
 *   node scripts/eval_harness/generate_dashboard.js
 *   node scripts/eval_harness/generate_dashboard.js tests/benchmarks/suites/wave_1_foundation
 *   node scripts/eval_harness/generate_dashboard.js tests/benchmarks/suites/wave_1_foundation tests/benchmarks/suites/wave_2_browser_agentics
 *
 * Output (default):
 *   scripts/eval_harness/dashboard/index.html
 *   scripts/eval_harness/dashboard/scores_data.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeDashboard, collectDashboardData } from '../../tests/benchmarks/score_recorder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function discoverSuiteDirs() {
  const root = path.join(repoRoot, 'tests', 'benchmarks', 'suites');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name));
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--all');
  let suiteDirs = args
    .map((a) => (path.isAbsolute(a) ? a : path.join(repoRoot, a)))
    .filter((p) => fs.existsSync(p));

  if (suiteDirs.length === 0) {
    suiteDirs = discoverSuiteDirs().filter((dir) => {
      return (
        fs.existsSync(path.join(dir, 'scores.json')) ||
        fs.existsSync(path.join(dir, 'prompts.json'))
      );
    });
  }

  if (suiteDirs.length === 0) {
    console.error('No suite directories found. Pass suite paths or run benchmarks first.');
    process.exit(1);
  }

  const outDir = path.join(repoRoot, 'scripts', 'eval_harness', 'dashboard');
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, 'index.html');
  const jsonPath = path.join(outDir, 'scores_data.json');

  const { payload } = writeDashboard(suiteDirs, htmlPath);
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Dashboard: ${htmlPath}`);
  console.log(`Data:      ${jsonPath}`);
  console.log(
    `Suites: ${payload.suites.map((s) => s.name).join(', ') || '(none)'} · runs: ${payload.runs.length}`
  );
  console.log(
    `Overall avg total: ${payload.aggregate.overall.avg_total} · pass rate: ${Math.round(
      (payload.aggregate.pass_rate || 0) * 100
    )}%`
  );
  const cats = Object.entries(payload.aggregate.by_category || {});
  if (cats.length) {
    console.log('Categories:');
    for (const [cat, agg] of cats) {
      console.log(`  ${cat}: avg ${agg.avg_total} (${agg.count} prompts, ${agg.pass_count} pass)`);
    }
  }
}

main();
