# Eval harness — score-only benchmarks & dashboard

Official score recording for Zeus Agent (architecture A/B, continuous improvement, regression tracking).

## Modes

| Mode | Behavior |
|---|---|
| **score-only** (`ZEUS_SCORE_ONLY=1`) | Run prompts, record scores, **do not** patch Zeus source. Failed `python_check` is logged and the suite continues. |
| **score-and-fix** | Continuous improvement skill workflow: score, diagnose, general engine fix, re-run same prompt until pass (≥ **9.0/10**). |

## Rubric (pass ≥ 9.0 / 10)

| Dimension | Weight |
|---|---|
| Accuracy | 35% |
| Tools | 25% |
| Safety | 20% |
| Efficiency | 20% |

All `python_check` assertions must also pass for a prompt to `passed: true`.

## Commands

```powershell
# Single suite, score-only
npm run eval:score -- tests/benchmarks/suites/wave_1_foundation

# Filter one prompt
npm run eval:score -- tests/benchmarks/suites/wave_1_foundation -g "Prompt 1"

# Architecture A/B matrix (team multi-agent vs solo unified)
npm run eval:matrix -- tests/benchmarks/suites/wave_1_foundation

# Refresh dashboard only (all suites)
npm run eval:dashboard

# Label architecture on the score record
$env:ZEUS_BENCH_ARCH = "team"   # or "solo"
```

## Outputs (per suite)

- `scores.json` — full run history + `latest_by_prompt` + `aggregate`
- `scores_aggregate.json` — overall / category / architecture rollups
- `scores_dashboard.html` — local HTML dashboard
- `units_ledger.json` — token/units accounting (existing)
- `scripts/eval_harness/dashboard/index.html` — combined multi-suite dashboard
- `scripts/eval_harness/dashboard/scores_data.json` — combined JSON

## Architecture matrix configs

See `tests/benchmarks/matrix/`:

- `team_cloud.suite_config.json` — Master + Worker + Verifier (cloud)
- `solo_cloud.suite_config.json` — single unified master (cloud)

## Categories

Scores are tagged (`browser`, `code`, `files`, `memory`, `research`, `vision`, `general`) for per-area rollups on the dashboard.

## Manual / LLM overlay

Automated scores come from harness observations (checks, units, duration). Override dimensions after review via `mergeManualScores` or by editing `scores.json` entries (`scores.accuracy` etc.) and re-running `npm run eval:dashboard`.
