import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBenchmarkSuite('Wave 1: Foundation Benchmarks (10 Prompts)', __dirname);
