#!/usr/bin/env node

/**
 * Deploys pre-built benchmark fixtures (logs, sample projects, data dumps)
 * into a target repository or task workspace.
 * 
 * Usage:
 *   node scripts/eval_harness/deploy_fixtures.js --dest "<destination_path>"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
let destDir = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dest' && args[i + 1]) {
    destDir = path.resolve(args[i + 1]);
    i++;
  }
}

if (!destDir) {
  destDir = path.resolve(process.cwd(), 'workspace');
}

const fixturesDir = path.join(__dirname, 'fixtures');

function copyRecursive(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }
  for (const item of fs.readdirSync(src)) {
    if (item.endsWith('.js') && item.startsWith('generate_')) continue;
    const srcPath = path.join(src, item);
    const dstPath = path.join(dst, item);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

console.log(`[Deploying Fixtures] From: ${fixturesDir}`);
console.log(`                    To:   ${destDir}`);

copyRecursive(fixturesDir, destDir);
console.log('✅ Benchmark fixtures deployed successfully:');
console.log('   - workspace/sample_validator/ (Prompt 4)');
console.log('   - workspace/data_dumps/       (Prompt 7)');
console.log('   - workspace/logs/             (Prompt 9)');
