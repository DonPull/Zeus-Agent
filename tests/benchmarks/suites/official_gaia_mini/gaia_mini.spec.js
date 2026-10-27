import { registerBenchmarkSuite } from '../../benchmark_engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Historical directory name retained for provenance; these are local synthetic exercises.
registerBenchmarkSuite('Synthetic file and answer exercises (GAIA-inspired)', __dirname);
