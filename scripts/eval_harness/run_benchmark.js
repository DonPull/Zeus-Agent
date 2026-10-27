#!/usr/bin/env node
/**
 * Unified Benchmark Suite Runner for Zeus Agent.
 * 
 * Supports:
 *   --profile [smoke|standard|full]   (default: standard)
 *   --suite [wave1|wave2|gaia|swe|all] (default: all)
 *   --arch [team|solo]                (default: team)
 *   --model [model_name]              (optional override)
 *   --supervised                      (waits for interactive permission & budget decisions)
 * 
 * Invariants:
 *   - Strictly non-intrusive: NEVER alters Zeus source code during evaluation.
 *   - Budget-bounded: Prevents runaway loops via calibrated credit thresholds.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { collectDashboardData, writeDashboard } from '../../tests/benchmarks/score_recorder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SUITE_MAP = {
    wave1: {
        title: 'Wave 1: Foundation',
        dir: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'wave_1_foundation'),
        spec: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'wave_1_foundation', 'wave_1_foundation.spec.js')
    },
    wave2: {
        title: 'Wave 2: Browser Agentics',
        dir: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'wave_2_browser_agentics'),
        spec: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'wave_2_browser_agentics', 'wave_2_browser_agentics.spec.js')
    },
    gaia: {
        title: 'Official GAIA-Mini',
        dir: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'official_gaia_mini'),
        spec: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'official_gaia_mini', 'gaia_mini.spec.js')
    },
    swe: {
        title: 'Official SWE-Mini',
        dir: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'official_swe_mini'),
        spec: path.join(repoRoot, 'tests', 'benchmarks', 'suites', 'official_swe_mini', 'swe_mini.spec.js')
    }
};

function parseArgs() {
    const raw = process.argv.slice(2);
    const options = {
        profile: 'standard',
        suite: 'all',
        arch: 'team',
        model: null,
        supervised: false,
        extraPlaywrightArgs: []
    };

    for (let i = 0; i < raw.length; i++) {
        const arg = raw[i];
        if (arg === '--profile') {
            options.profile = raw[++i] || 'standard';
        } else if (arg === '--suite') {
            options.suite = raw[++i] || 'all';
        } else if (arg === '--arch') {
            options.arch = raw[++i] || 'team';
        } else if (arg === '--model') {
            options.model = raw[++i];
        } else if (arg === '--supervised' || arg === '-s') {
            options.supervised = true;
        } else if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        } else {
            options.extraPlaywrightArgs.push(arg);
        }
    }
    return options;
}

function printHelp() {
    console.log(`
Zeus Agent — Unified Benchmark Suite Runner

Usage:
  node scripts/eval_harness/run_benchmark.js [options] [playwright args...]

Options:
  --profile [smoke|standard|full]   Execution tier (default: standard)
                                    smoke: 1 quick task per suite (~3-5 mins total)
                                    standard: balanced core suite (~20-30 mins)
                                    full: complete test matrix
  --suite [wave1|wave2|gaia|swe|all] Specific suite to execute (default: all)
  --arch [team|solo]                Multi-agent team or single-agent solo (default: team)
  --model [model_name]              Override default target LLM
  --supervised, -s                  Enable interactive human-in-the-loop permission & budget decisions

Examples:
  npm run bench:smoke
  node scripts/eval_harness/run_benchmark.js --profile smoke --suite gaia
  node scripts/eval_harness/run_benchmark.js --profile standard --arch solo
`);
}

async function main() {
    const opts = parseArgs();

    console.log(`\n======================================================`);
    console.log(`⚡ ZEUS AGENT BENCHMARK SUITE`);
    console.log(`======================================================`);
    console.log(`Profile:      ${opts.profile.toUpperCase()}`);
    console.log(`Suite:        ${opts.suite.toUpperCase()}`);
    console.log(`Architecture: ${opts.arch.toUpperCase()}`);
    if (opts.model) console.log(`Model:        ${opts.model}`);
    console.log(`Supervised:   ${opts.supervised ? 'YES (Interactive Decisions)' : 'NO (Observant Simulator)'}`);
    console.log(`======================================================\n`);

    // Determine target specs
    let targetSuites = [];
    if (opts.suite === 'all') {
        targetSuites = Object.values(SUITE_MAP);
    } else if (SUITE_MAP[opts.suite]) {
        targetSuites = [SUITE_MAP[opts.suite]];
    } else {
        console.error(`Unknown suite: ${opts.suite}. Available: ${Object.keys(SUITE_MAP).join(', ')}, all`);
        process.exit(1);
    }

    // Set benchmark environment variables
    const env = {
        ...process.env,
        ZEUS_BENCH_PROFILE: opts.profile,
        ZEUS_BENCH_ARCH: opts.arch,
        ZEUS_BENCH_MODE: 'benchmark',
        ZEUS_BENCH_CONTINUE: '1',
        ZEUS_SCORE_ONLY: '1',
        ...(opts.supervised ? { ZEUS_BENCH_SUPERVISED: '1', ZEUS_INTERACTIVE_EVAL: '1' } : {}),
        ...(opts.model ? { ZEUS_BENCHMARK_MODEL: opts.model } : {})
    };

    if (opts.arch === 'solo') {
        env.ZEUS_BENCH_WORKER_MODEL = 'None';
        env.ZEUS_BENCH_VERIFIER_MODEL = 'None';
        env.ZEUS_BENCH_WATCHER_MODEL = 'None';
    }

    const executedSuiteDirs = [];

    for (const s of targetSuites) {
        if (!fs.existsSync(s.spec)) {
            console.warn(`[Benchmark Runner] Spec file not found: ${s.spec}`);
            continue;
        }

        console.log(`\n▶️ Executing Suite: ${s.title} (${path.basename(s.spec)})...`);
        executedSuiteDirs.push(s.dir);

        const pwArgs = [
            'playwright',
            'test',
            s.spec,
            '--reporter=list',
            ...opts.extraPlaywrightArgs
        ];

        spawnSync('npx', pwArgs, {
            cwd: repoRoot,
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32'
        });
    }

    // Generate comprehensive aggregate dashboard
    console.log(`\n📊 Generating Benchmark Dashboard...`);
    try {
        const dashboardOut = path.join(repoRoot, 'scores_dashboard.html');
        writeDashboard(executedSuiteDirs, dashboardOut);
        const data = collectDashboardData(executedSuiteDirs);
        const agg = data.aggregate;

        console.log(`\n======================================================`);
        console.log(`🏁 BENCHMARK RUN RESULTS SUMMARY`);
        console.log(`======================================================`);
        console.log(`Prompts Evaluated: ${agg.prompt_count || data.runs.length}`);
        console.log(`Overall Pass Rate: ${Math.round((agg.pass_rate || 0) * 100)}% (${agg.overall?.pass_count || 0} passed)`);
        console.log(`Average Score:     ${agg.overall?.avg_total || 0} / 10.0`);
        console.log(`Average Units:     ${(agg.overall?.avg_units || 0).toLocaleString()} units`);
        console.log(`Average Duration:  ${agg.overall?.avg_duration_seconds || 0}s`);
        console.log(`Dashboard File:    file:///${dashboardOut.replace(/\\/g, '/')}`);
        console.log(`======================================================\n`);
    } catch (e) {
        console.error('[Benchmark Runner] Failed to generate aggregate dashboard:', e.message);
    }
}

main().catch(err => {
    console.error('[Benchmark Runner] Fatal error:', err);
    process.exit(1);
});
