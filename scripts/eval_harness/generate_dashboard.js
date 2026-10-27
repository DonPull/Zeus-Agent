#!/usr/bin/env node
/** Rebuild derived reports from retained trials. Never launches an agent. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDashboard, loadScores } from '../../tests/benchmarks/score_recorder.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function discoverResultDirs(roots) {
  const found = new Set();
  const visit = dir => {
    if (fs.existsSync(path.join(dir, 'trials')) || fs.existsSync(path.join(dir, 'scores.json'))) {
      if (loadScores(dir).runs.length) found.add(fs.realpathSync(dir));
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path.join(dir, entry.name));
    }
  };
  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Missing results directory: ${root}`);
    visit(root);
  }
  if (!found.size) throw new Error('No retained trials found. Run eval:demo or an explicitly authorized evaluation first.');
  return [...found].sort();
}

export function generateDashboard(inputs = [], root = repoRoot) {
  if (inputs.some(arg => arg.startsWith('-'))) throw new Error('Usage: npm run eval:dashboard -- [results-directory ...]');
  const evaluationRoot = path.join(root, '.zeus/evaluations');
  const dirs = discoverResultDirs((inputs.length ? inputs : [evaluationRoot]).map(dir => path.resolve(root, dir)));
  return writeDashboard(dirs, path.join(evaluationRoot, 'dashboard/index.html'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { out, payload } = generateDashboard(process.argv.slice(2));
    console.log(JSON.stringify({ report: out, trials: payload.runs.length,
      verified_passes: payload.aggregate.overall.pass_count, outcome_passes: payload.aggregate.overall.outcome_pass_count }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
