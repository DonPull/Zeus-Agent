import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBenchmarkSuite('Official GAIA-Mini Benchmark', __dirname, {
    default_model: process.env.ZEUS_BENCHMARK_MODEL || "Qwen3.8-27B",
    budget_credits: 40000,
    prompt_timeout_ms: 10 * 60 * 1000,
    turn_timeout_ms: 6 * 60 * 1000
});
