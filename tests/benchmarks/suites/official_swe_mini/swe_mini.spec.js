import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBenchmarkSuite('Official SWE-Mini Benchmark', __dirname, {
    default_model: process.env.ZEUS_BENCHMARK_MODEL || "Qwen3.8-27B",
    budget_credits: 45000,
    prompt_timeout_ms: 12 * 60 * 1000,
    turn_timeout_ms: 8 * 60 * 1000
});
