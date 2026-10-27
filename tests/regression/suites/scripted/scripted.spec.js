import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerBenchmarkSuite } from '../../../benchmarks/benchmark_engine.js';

registerBenchmarkSuite('Scripted evaluation pipeline', path.dirname(fileURLToPath(import.meta.url)));
