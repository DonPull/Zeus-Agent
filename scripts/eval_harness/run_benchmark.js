#!/usr/bin/env node
import { parseArgs, runBenchmarks, printHelp } from './runner.js';
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) printHelp();
  else {
    const result = runBenchmarks(options);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.code;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
