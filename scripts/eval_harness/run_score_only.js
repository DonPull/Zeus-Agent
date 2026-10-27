#!/usr/bin/env node
import { parseArgs, runBenchmarks, printHelp } from './runner.js';
try {
  const [dir, ...args] = process.argv.slice(2);
  if (!dir || dir === '--help' || dir === '-h') { printHelp(); if (!dir) process.exitCode = 1; }
  else {
    const result = runBenchmarks(parseArgs(['--suite-dir', dir, ...args]));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.code;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
