import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Historical directory name retained for provenance; these are not SWE-bench instances.
registerBenchmarkSuite('Synthetic code-repair exercises (SWE-inspired)', __dirname);
