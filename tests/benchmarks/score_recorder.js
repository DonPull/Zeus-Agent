/**
 * Score recording, schema, and aggregation for Zeus Agent benchmarks.
 * Used by benchmark_engine.js (score-only or score-and-fix workflows).
 *
 * Score model (0-10 per dimension, weighted total >= 9.0 to pass):
 *   accuracy  35%  - python_check / expected artifacts
 *   tools     25%  - directive/tool health (parse thrash, path errors) when available
 *   safety    20%  - sandbox / gatekeeper / policy
 *   efficiency 20% - units, wall time, loops
 *
 * SCORE_ONLY=1 records results without requiring a perfect run for the harness
 * to continue other prompts (failed checks are logged, not always thrown).
 */

import fs from 'fs';
import path from 'path';

export const RUBRIC_WEIGHTS = {
  accuracy: 0.35,
  tools: 0.25,
  safety: 0.2,
  efficiency: 0.2,
};

export const PASS_THRESHOLD = 9.0;

/** Category tags inferred from prompt name / criteria for dashboard grouping. */
const CATEGORY_RULES = [
  { category: 'browser', patterns: [/browser|canva|scrap|heatmap|web|url|http/i] },
  { category: 'code', patterns: [/bug|pytest|pipeline|etl|script|validator|marathon|refactor/i] },
  { category: 'files', patterns: [/file|workspace|csv|json|dedup|reconcil|log|search/i] },
  { category: 'memory', patterns: [/memory|brand|recall/i] },
  { category: 'research', patterns: [/stock|dossier|research|financial|weather/i] },
  { category: 'vision', patterns: [/visual|design|banner|image|flyer|screenshot/i] },
];

export function inferCategories(promptSpec) {
  const hay = `${promptSpec.name || ''} ${promptSpec.title || ''} ${JSON.stringify(promptSpec.criteria || {})}`;
  const cats = new Set();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(hay))) cats.add(rule.category);
  }
  if (cats.size === 0) cats.add('general');
  return [...cats];
}

export function computeWeightedScore(scores) {
  const s = {
    accuracy: clampScore(scores.accuracy),
    tools: clampScore(scores.tools),
    safety: clampScore(scores.safety),
    efficiency: clampScore(scores.efficiency),
  };
  const total =
    s.accuracy * RUBRIC_WEIGHTS.accuracy +
    s.tools * RUBRIC_WEIGHTS.tools +
    s.safety * RUBRIC_WEIGHTS.safety +
    s.efficiency * RUBRIC_WEIGHTS.efficiency;
  return {
    scores: s,
    total: Math.round(total * 100) / 100,
    passed: total >= PASS_THRESHOLD && (scores.python_check_passed !== false),
  };
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(10, x));
}

/**
 * Deterministic scoring from harness observations.
 * Optional manual/LLM overlay can merge later via mergeManualScores().
 */
export function scoreFromHarnessObservation({
  pythonCheckPassed,
  pythonCheckDetails = [],
  unitsUsed = 0,
  durationSeconds = 0,
  toolErrors = 0,
  gatekeeperBlocks = 0,
  circularLoopHints = 0,
}) {
  const checks = pythonCheckDetails.length || 1;
  const passedChecks = pythonCheckDetails.length
    ? pythonCheckDetails.filter((c) => c.passed).length
    : pythonCheckPassed
      ? 1
      : 0;
  const accuracy =
    pythonCheckPassed === true
      ? 10
      : pythonCheckPassed === false
        ? Math.max(0, (passedChecks / checks) * 8)
        : 6;

  // Fewer tool parse/path errors is better.
  const tools = Math.max(0, 10 - toolErrors * 1.5 - circularLoopHints * 2);

  // Gatekeeper blocks during eval can be OK; many unexpected blocks hurt.
  const safety = Math.max(0, 10 - gatekeeperBlocks * 1.0);

  // Efficiency: heavy unit burn relative to simple tasks is soft-penalized.
  // Baseline ~50k units for a healthy multi-turn prompt; scale gently.
  let efficiency = 10;
  if (unitsUsed > 200000) efficiency -= 2;
  if (unitsUsed > 400000) efficiency -= 2;
  if (unitsUsed > 800000) efficiency -= 2;
  if (durationSeconds > 600) efficiency -= 1;
  if (durationSeconds > 1200) efficiency -= 1;
  if (circularLoopHints > 0) efficiency -= circularLoopHints * 1.5;
  efficiency = Math.max(0, efficiency);

  return computeWeightedScore({
    accuracy,
    tools,
    safety,
    efficiency,
    python_check_passed: pythonCheckPassed !== false,
  });
}

export function mergeManualScores(autoResult, manual) {
  if (!manual) return autoResult;
  const scores = { ...autoResult.scores };
  for (const k of Object.keys(scores)) {
    if (manual[k] != null) scores[k] = clampScore(manual[k]);
  }
  const recomputed = computeWeightedScore({
    ...scores,
    python_check_passed: manual.python_check_passed ?? autoResult.passed,
  });
  return { ...recomputed, manual: true };
}

/**
 * Build a full score record for one prompt run.
 */
export function buildScoreRecord({
  suiteTitle,
  suiteDir,
  promptSpec,
  runMeta = {},
  pythonCheckPassed,
  pythonCheckDetails = [],
  unitsUsed = 0,
  messageCount = 0,
  modelsUsed = [],
  durationSeconds = 0,
  toolErrors = 0,
  gatekeeperBlocks = 0,
  circularLoopHints = 0,
  manualScores = null,
  mode = process.env.ZEUS_BENCH_MODE || 'score-only',
}) {
  const categories = promptSpec.categories || inferCategories(promptSpec);
  const auto = scoreFromHarnessObservation({
    pythonCheckPassed,
    pythonCheckDetails,
    unitsUsed,
    durationSeconds,
    toolErrors,
    gatekeeperBlocks,
    circularLoopHints,
  });
  const finalScore = mergeManualScores(auto, manualScores);

  return {
    schema_version: 1,
    suite: suiteTitle,
    suite_dir: suiteDir,
    prompt_id: promptSpec.id,
    name: promptSpec.name,
    title: promptSpec.title,
    categories,
    mode,
    architecture: runMeta.architecture || process.env.ZEUS_BENCH_ARCH || 'unknown',
    model_set: {
      master: runMeta.master_model || null,
      worker: runMeta.worker_model || null,
      verifier: runMeta.verifier_model || null,
      watcher: runMeta.watcher_model || null,
      vision: runMeta.vision_model || null,
      models_used: modelsUsed,
    },
    turns: promptSpec.turns?.map((t) => t.turn) ?? [],
    python_check_passed: pythonCheckPassed !== false,
    python_check_details: pythonCheckDetails,
    scores: finalScore.scores,
    total_score: finalScore.total,
    passed: finalScore.passed && pythonCheckPassed !== false,
    pass_threshold: PASS_THRESHOLD,
    units_used: unitsUsed,
    message_count: messageCount,
    duration_seconds: durationSeconds,
    tool_errors: toolErrors,
    gatekeeper_blocks: gatekeeperBlocks,
    circular_loop_hints: circularLoopHints,
    status: runMeta.status || 'unknown',
    timestamp: new Date().toISOString(),
    run_id: runMeta.run_id || null,
  };
}

export function scoreFilePath(suiteDir) {
  return path.join(suiteDir, 'scores.json');
}

export function loadScores(suiteDir) {
  const file = scoreFilePath(suiteDir);
  if (!fs.existsSync(file)) return { schema_version: 1, runs: [] };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data.runs)) return data;
    return { schema_version: 1, runs: [] };
  } catch {
    return { schema_version: 1, runs: [] };
  }
}

export function appendScore(suiteDir, record) {
  const data = loadScores(suiteDir);
  data.runs.push(record);
  data.updated_at = new Date().toISOString();
  // Also keep a latest-by-prompt map for quick dashboard reads.
  data.latest_by_prompt = data.latest_by_prompt || {};
  data.latest_by_prompt[String(record.prompt_id)] = record;
  const aggregates = aggregateScores(data.runs);
  data.aggregate = aggregates;
  fs.writeFileSync(scoreFilePath(suiteDir), JSON.stringify(data, null, 2), 'utf8');
  writeAggregateSidecar(suiteDir, aggregates, data.runs);
  return record;
}

function writeAggregateSidecar(suiteDir, aggregates, runs) {
  const file = path.join(suiteDir, 'scores_aggregate.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ aggregates, run_count: runs.length, updated_at: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

/**
 * Aggregate overall + per-category + per-architecture metrics.
 */
export function aggregateScores(runs) {
  if (!runs.length) {
    return {
      overall: emptyAgg(),
      by_category: {},
      by_architecture: {},
      by_mode: {},
      pass_rate: 0,
    };
  }

  const latestByPrompt = new Map();
  for (const r of runs) {
    latestByPrompt.set(String(r.prompt_id), r);
  }
  const latest = [...latestByPrompt.values()];

  const overall = foldAgg(latest);
  const by_category = {};
  const by_architecture = {};
  const by_mode = {};

  for (const r of latest) {
    for (const c of r.categories || ['general']) {
      by_category[c] = foldAgg(latest.filter((x) => (x.categories || []).includes(c)), by_category[c]);
    }
    const arch = r.architecture || 'unknown';
    by_architecture[arch] = foldAgg(latest.filter((x) => (x.architecture || 'unknown') === arch), by_architecture[arch]);
    const mode = r.mode || 'unknown';
    by_mode[mode] = foldAgg(latest.filter((x) => (x.mode || 'unknown') === mode), by_mode[mode]);
  }

  const pass_rate = latest.filter((r) => r.passed).length / latest.length;

  return {
    overall,
    by_category: sortAggMap(by_category),
    by_architecture: sortAggMap(by_architecture),
    by_mode: sortAggMap(by_mode),
    pass_rate: Math.round(pass_rate * 1000) / 1000,
    prompt_count: latest.length,
  };
}

function emptyAgg() {
  return {
    count: 0,
    avg_total: 0,
    avg_scores: { accuracy: 0, tools: 0, safety: 0, efficiency: 0 },
    avg_units: 0,
    avg_duration_seconds: 0,
    pass_count: 0,
  };
}

function foldAgg(rows, prev = emptyAgg()) {
  // foldAgg is called with the full filtered list each time; compute fresh.
  void prev;
  if (!rows.length) return emptyAgg();
  const n = rows.length;
  const sum = (fn) => rows.reduce((a, r) => a + (fn(r) || 0), 0);
  return {
    count: n,
    avg_total: round2(sum((r) => r.total_score) / n),
    avg_scores: {
      accuracy: round2(sum((r) => r.scores?.accuracy) / n),
      tools: round2(sum((r) => r.scores?.tools) / n),
      safety: round2(sum((r) => r.scores?.safety) / n),
      efficiency: round2(sum((r) => r.scores?.efficiency) / n),
    },
    avg_units: Math.round(sum((r) => r.units_used) / n),
    avg_duration_seconds: Math.round(sum((r) => r.duration_seconds) / n),
    pass_count: rows.filter((r) => r.passed).length,
  };
}

function sortAggMap(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort((a, b) => (b[1].avg_total || 0) - (a[1].avg_total || 0))
  );
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Merge multiple suite scores.json files into one dashboard payload.
 */
export function collectDashboardData(suiteDirs) {
  const allRuns = [];
  const suites = [];
  for (const dir of suiteDirs) {
    const data = loadScores(dir);
    suites.push({
      dir,
      name: path.basename(dir),
      aggregates: data.aggregate || aggregateScores(data.runs),
      run_count: data.runs.length,
    });
    allRuns.push(...data.runs);
  }
  return {
    generated_at: new Date().toISOString(),
    pass_threshold: PASS_THRESHOLD,
    weights: RUBRIC_WEIGHTS,
    suites,
    aggregate: aggregateScores(allRuns),
    runs: allRuns.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')),
  };
}

export function renderDashboardHtml(payload) {
  const rows = payload.runs
    .map((r) => {
      const badge = r.passed ? 'pass' : 'fail';
      return `<tr class="${badge}">
        <td>${escapeHtml(String(r.prompt_id))}</td>
        <td>${escapeHtml(r.name || '')}</td>
        <td>${escapeHtml((r.categories || []).join(', '))}</td>
        <td>${escapeHtml(r.architecture || '')}</td>
        <td>${escapeHtml(r.mode || '')}</td>
        <td>${r.total_score?.toFixed?.(2) ?? r.total_score}</td>
        <td>${r.scores?.accuracy ?? ''}</td>
        <td>${r.scores?.tools ?? ''}</td>
        <td>${r.scores?.safety ?? ''}</td>
        <td>${r.scores?.efficiency ?? ''}</td>
        <td>${r.units_used ?? ''}</td>
        <td>${r.duration_seconds ?? ''}</td>
        <td><span class="badge ${badge}">${r.passed ? 'PASS' : 'FAIL'}</span></td>
        <td>${escapeHtml(r.timestamp || '')}</td>
      </tr>`;
    })
    .join('\n');

  const catBars = Object.entries(payload.aggregate.by_category || {})
    .map(([cat, agg]) => {
      const pct = Math.round((agg.avg_total / 10) * 100);
      return `<div class="cat"><div class="cat-label">${escapeHtml(cat)} <small>(${agg.count})</small></div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div><span>${agg.avg_total}</span></div></div>`;
    })
    .join('\n');

  const archRows = Object.entries(payload.aggregate.by_architecture || {})
    .map(
      ([arch, agg]) =>
        `<tr><td>${escapeHtml(arch)}</td><td>${agg.avg_total}</td><td>${agg.pass_count}/${agg.count}</td><td>${agg.avg_units}</td></tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Zeus Agent Benchmark Scores</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0f1115; color:#e8eaed; margin:24px; }
  h1,h2 { font-weight:600; }
  .meta { color:#9aa0a6; margin-bottom:16px; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin:16px 0 24px; }
  .card { background:#1a1d24; border:1px solid #2a2f3a; border-radius:10px; padding:14px 18px; min-width:140px; }
  .card .label { color:#9aa0a6; font-size:12px; }
  .card .value { font-size:28px; font-weight:700; margin-top:4px; }
  .pass .value { color:#3ddc97; }
  .fail .value { color:#ff6b6b; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { border-bottom:1px solid #2a2f3a; padding:8px 10px; text-align:left; }
  th { color:#9aa0a6; font-weight:600; position:sticky; top:0; background:#0f1115; }
  tr.fail td:first-child { color:#ff8e8e; }
  .badge { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .badge.pass { background:#143d2b; color:#3ddc97; }
  .badge.fail { background:#3d1414; color:#ff6b6b; }
  .cat { margin:8px 0; }
  .cat-label { font-size:13px; color:#c5c7cc; margin-bottom:4px; }
  .bar { position:relative; background:#1a1d24; border:1px solid #2a2f3a; border-radius:6px; height:22px; overflow:hidden; }
  .bar .fill { height:100%; background:linear-gradient(90deg,#3b82f6,#3ddc97); }
  .bar span { position:absolute; right:8px; top:2px; font-size:12px; }
  .scroll { overflow:auto; max-height:70vh; border:1px solid #2a2f3a; border-radius:10px; }
</style>
</head>
<body>
  <h1>Zeus Agent — Benchmark Score Dashboard</h1>
  <div class="meta">Generated ${escapeHtml(payload.generated_at)} · Pass threshold ≥ ${payload.pass_threshold} · Accuracy 35% / Tools 25% / Safety 20% / Efficiency 20%</div>

  <div class="cards">
    <div class="card ${payload.aggregate.pass_rate >= 0.9 ? 'pass' : ''}">
      <div class="label">Pass rate (latest)</div>
      <div class="value">${Math.round((payload.aggregate.pass_rate || 0) * 100)}%</div>
    </div>
    <div class="card">
      <div class="label">Avg total</div>
      <div class="value">${payload.aggregate.overall.avg_total}</div>
    </div>
    <div class="card">
      <div class="label">Prompts</div>
      <div class="value">${payload.aggregate.prompt_count || payload.runs.length}</div>
    </div>
    <div class="card">
      <div class="label">Avg units</div>
      <div class="value">${payload.aggregate.overall.avg_units}</div>
    </div>
  </div>

  <h2>Category scores</h2>
  <div>${catBars || '<em>No categorized runs yet</em>'}</div>

  <h2>Architecture comparison</h2>
  <table>
    <thead><tr><th>Architecture</th><th>Avg total</th><th>Pass</th><th>Avg units</th></tr></thead>
    <tbody>${archRows || '<tr><td colspan="4">No data</td></tr>'}</tbody>
  </table>

  <h2>Runs</h2>
  <div class="scroll">
  <table>
    <thead>
      <tr>
        <th>#</th><th>Name</th><th>Categories</th><th>Arch</th><th>Mode</th>
        <th>Total</th><th>Acc</th><th>Tools</th><th>Safety</th><th>Effic</th>
        <th>Units</th><th>Sec</th><th>Result</th><th>Timestamp</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="14">No runs recorded</td></tr>'}</tbody>
  </table>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Write dashboard HTML next to scores (or to outPath).
 */
export function writeDashboard(suiteDirs, outPath) {
  const payload = collectDashboardData(suiteDirs);
  const html = renderDashboardHtml(payload);
  const out = outPath || path.join(suiteDirs[0] || process.cwd(), 'scores_dashboard.html');
  fs.writeFileSync(out, html, 'utf8');
  return { out, payload };
}
