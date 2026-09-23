import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBenchmarkSuite('Wave 2: Browser Agentics & Observability', __dirname);
