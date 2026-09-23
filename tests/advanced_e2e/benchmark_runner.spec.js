import { registerBenchmarkSuite } from '../benchmarks/benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canonical delegation to the unified benchmark engine using the Wave 1 Foundation suite
const wave1Dir = path.resolve(__dirname, '../benchmarks/suites/wave_1_foundation');
registerBenchmarkSuite('Zeus Agent Autonomous Benchmark Suite (10 Real-World Prompts)', wave1Dir);
