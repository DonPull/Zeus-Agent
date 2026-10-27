#!/usr/bin/env node
import path from 'node:path';
import { parseArgs, runBenchmarks, repoRoot, printHelp } from './runner.js';
try {
  const [dir, ...args] = process.argv.slice(2);
  if (!dir || dir === '--help' || dir === '-h') { printHelp(); if (!dir) process.exitCode = 1; }
  else {
    let code = 0;
    for (const architecture of ['team', 'solo']) {
      const options = parseArgs(['--suite-dir', dir, ...args, '--arch', architecture,
        '--matrix-config', path.join(repoRoot, 'tests/benchmarks/matrix', `${architecture}_cloud.suite_config.json`)]);
      if (options.output) options.output = path.join(options.output, architecture);
      const result = runBenchmarks(options); console.log(JSON.stringify({ architecture, ...result }, null, 2));
      code ||= result.code;
    }
    process.exitCode = code;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
