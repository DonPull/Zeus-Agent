# Zeus evaluation and regression guide

The approved [development plan](../../docs/IMPLEMENTATION_PLAN.md) starts with trustworthy measurement. Ordinary regression checks use controlled replies to test the software. Capability evaluations let a model attempt a task and need separate task graders and a cost budget. Passing scripted checks is not evidence of agent intelligence.

## Safe local checks

Install dependencies with `npm ci`; install Rust/MSVC, Python 3.10+, and WebView2 for Windows desktop checks. CI pins Node 22, Python 3.11, and Rust 1.94.1. The Cargo lockfile is retained.

```powershell
npm run build
npm run test:unit         # Node configuration, runner, grader, and recorder tests
npm run test:backend      # cargo test --lib --locked
npm run test:ui           # Explicit offline desktop allowlist
npm run test:regression   # All offline groups; nonzero if any group fails
npm run bench:validate    # Six mission graders with known references/wrong submissions
npm run eval:demo         # Controlled mixed pass/failure report; no models
npm run eval:dashboard    # Rebuild combined report from retained records
```

The orchestrator runs only `tests/unit/*.test.js`, `tests/missions/graders.test.js`, backend library tests, and `playwright.offline.config.js`. It does not include the existing live advanced E2E specs. The offline runtime requires an explicit HTTP loopback mock endpoint, uses a dummy key, and cannot fall back to a hosted provider. Each desktop launch gets a unique ignored workspace and test database. It does not delete or use manual conversations. Windows helpers and the test app run hidden.

Phase 2A adds [six mission contracts and validated graders](../../tests/benchmarks/missions/README.md). Their reference solutions and deliberately incorrect controls test the evaluator, not agent intelligence. Efficient live-model tests may be used separately when useful; ordinary offline regression remains repeatable without credentials.

Desktop coverage currently checks real bridge calls, streaming Chat/Responses usage, missing usage, empty replies, message ordering/reload, cancellation, shared Master/Worker/Verifier spend, an interactive command approval, attachment bytes/path persistence, and a scripted trial through the benchmark pipeline. Browser preview/session/replay and actual image perception are not established by this smoke set. Existing Rust tests additionally cover run recovery, policy rules, message visibility/order, directive parsing, Python restrictions, and cancellation. This is an initial regression suite, not exhaustive production certification.

The Windows workflow in `.github/workflows/regression.yml` builds and runs these offline commands without provider secrets. Its remote execution has not yet been verified.

## Native supervised mission diagnostic

The Phase 2 driver runs the production Rust library in a separate feature-gated `zeus-evaluation` executable. It uses fresh test data, normal permissions, and no inherited browser profiles/extensions. The live/mock provider choice is independent of policy; old suites explicitly request their legacy evaluation policy. Offline credential readiness uses only the validated mock configuration and does not touch the user's credential vault.

The first diagnostic is deliberately limited to synthetic **D01**, which grades JSON data without executing submitted programs. The user selected native supervised execution rather than preparing a VM. This shares the host's permissions; it is not an isolated benchmark or proof of adversarial safety.

```powershell
npm run bench:diagnose -- --dry-run
npm run bench:diagnose -- --live --model gpt-5-nano
```

The default is a dry run. Live preflight checks the exact model against the app's Abacus catalogue and refuses missing credentials or a locally registered ID. Each invocation permits one task attempt, no automatic trial retries, six model requests across all roles/retries, one in flight, twelve directives, 4,096 output tokens per request, 100,000 token equivalents including input reservations, and 180 seconds. These are operational bounds, not a dollar/subscription-credit ceiling. Reserve estimates use serialized request bytes divided by three; actual reported usage can exceed the estimate. Unknown usage stops later dispatch rather than becoming a free retry. During bounded diagnostics, an HTTP provider failure is returned directly instead of being obscured by compatibility retries blocked by that safeguard.

The separate Zeus window shows normal approval cards. The controller records requests/decisions and waits for user or external supervisor review; it does not broadly approve commands or Python scripts. A known Windows path-normalization problem can request approval even for intended workspace writes. That remains a production-policy bug to repair with dedicated tests; the benchmark does not bypass it.

Each experiment retains its preflight manifest, source/configuration hashes, immutable trial, journal, bounded debug log, screenshot, exported files/hashes, criterion assessment, interventions, and rebuildable dashboard. Startup/preflight failures also produce failure records. Exit codes: `0` fully verified pass, `2` independently passed outcome with authorization unverified, `1` failure/error. Native authorization coverage is partial and currently cannot produce a fully verified pass. Live executable outputs are never graded on the evaluator host; only exact known scripted-control hashes permit executable reference grading.

The scripted desktop suite drives all six missions through the bridge, including a false B01 completion claim which correctly fails and V01 uploads whose exact PNG bytes reach the mocked vision helper. These are regression checks, not capability results. See [mission details](../../tests/benchmarks/missions/README.md). A repeated capability baseline, isolated execution, and authorization proof remain later work.

## Capability evaluation commands (legacy suites)

Inspect resolved settings first; this makes no model calls:

```powershell
npm run bench:smoke -- --dry-run
npm run eval:score -- tests/benchmarks/suites/wave_1_foundation --arch solo --model route-llm --dry-run
npm run eval:matrix -- tests/benchmarks/suites/wave_1_foundation --dry-run
```

Only after choosing models, trials, tasks, and a cost envelope, opt in explicitly:

```powershell
npm run bench:smoke -- --suite wave1 --arch solo --model route-llm --trials 2 --live
```

`--live` or `ZEUS_ALLOW_LIVE_EVAL=1` permits real provider requests. It is not a provider-credit cap. The task allowance is expressed in token equivalents; provider usage may arrive after a request completes and can exceed remaining allowance. Deadlines bound execution, while unknown interrupted usage remains unknown. Account/experiment credit ceilings and pricing reconciliation are not implemented.

Supported flags are `--suite wave1|wave2|gaia|swe|all`, `--suite-dir`, `--profile smoke|standard|full`, `--arch solo|team`, `--model`, `--matrix-config`, `--trials 1..100`, `--output`, `--grep`/`-g`, `--supervised`, `--dry-run`, and `--live`. Unknown flags fail. The old `--smoke` shorthand is replaced by `--profile smoke` or the npm script.

The GAIA/SWE aliases and historically named `official_*_mini` directories select local synthetic exercises. They do not implement the official GAIA or SWE-bench benchmarks. The legacy `eval:benchmark` script prepares an older evaluator workflow; it is not part of the new regression or capability baseline.

## Effective configuration

Resolution order is built-in defaults -> suite JSON -> matrix/profile JSON -> environment/explicit CLI overrides -> task overrides. A CLI flag overrides its corresponding environment value. The same resolver supplies preflight output and runtime settings; the runner reads persisted task settings back and fails on mismatches. Solo disables Worker and Verifier. Watcher is configured independently of collaboration mode.

All matrix settings are passed through, including role models, effort, limits, browser mode, and permission policy. The gateway still selects provider endpoints using its existing model routing and local registry. Configuration labels this `runtime_selected`; arbitrary provider overrides are rejected. Actual request endpoint origins and roles appear in the task usage summary, without query strings or credentials. This phase does not introduce new provider routing.

The checked-in matrix files are historical examples, not tuned recommendations. Their Watcher settings differ, and Solo does not yet force the local single-agent system prompt for a hosted model. They are insufficient for a controlled architecture comparison until Phase 2 selects matched configurations.

Live suites retain their historical evaluation privilege bypasses and approval simulator, explicitly labeled `legacy-eval-with-user-simulator`. They do not represent production authorization behavior. Offline desktop smoke checks do not enable those bypasses. The scripted no-tools suite uses its own restricted evaluation policy; neither policy can be relabeled arbitrarily.

## Records and pass criteria

New output goes under ignored `.zeus/evaluations/<experiment>/`. Each suite has:

- `trials/<trial_id>.json`: immutable schema-v2 raw trial records, exclusively published without overwriting an existing trial.
- `scores.json`: derived history/aggregates rebuilt from raw records.
- `index.html` and `scores_data.json`: derived reports.
- `artifacts/`: persisted runtime journal and actual desktop screenshot, with integrity hashes.

Records include experiment/trial/task/run identity, suite and task hashes, grader version, fixture hash, source commit, dirty diff hash (including untracked source), effective configuration and fingerprint, execution/outcome/authorization status, raw check evidence, usage, and timing. Provider model snapshots remain unavailable unless supplied by the provider. Local artifacts can contain task content; they are ignored by git and are not comprehensively redacted for publication.

Execution statuses include succeeded, failed, timed out, cancelled, interrupted, infrastructure error, unsupported, and unknown. Startup and missing-trial failures produce records. Result-write failures propagate rather than being swallowed. A bad task result does not suppress later trials.

A fully verified `passed` requires successful execution, passed independent outcome checks, and passed independent authorization checks. `outcome_passed` is reported separately. No check means not evaluated. Existing live suites still lack independent authorization graders, so even correct outputs remain unverified and the command returns nonzero. Phase 2 must add those graders before claiming a verified capability baseline; do not loosen the recorder to make legacy suites green.

Accuracy/tools/safety/efficiency retain the old diagnostic rubric fields for compatibility. Unobserved dimensions and totals remain null. Fewer approval prompts do not imply better safety, and a legitimate denial is not automatically a penalty. Manual diagnostic scores cannot override execution, outcome, or authorization failure. The demo deliberately retains five scenarios (one verified pass, a failed check, startup error, timeout, and ungraded task), and is labeled `scripted_runtime`.

All trials, including failures, remain in aggregates. Distinct suites, configurations, architectures, experiments, and repeated attempts do not collide on a bare prompt ID. Duplicate trial identities with conflicting content are errors. Compare matched experiment/configuration cells; the combined all-history pass rate is not a release comparison.

## Usage and budgets

A durable row is created for each actual gateway attempt, scoped to task/run/role. The same request is updated idempotently, while a billed retry has a new identity. Usage and task spend update atomically. Master, Worker, Verifier, Watcher, vision, and global policy-editor requests are instrumented; global calls have no task owner. The next acting agent reads shared spend instead of relying on a stale parent counter.

Reasoning tokens are an output subset and cached tokens are an input subset. For input=75, output=1,186, reasoning=1,024, the counted total is 1,261 tokens. Tool/image counts do not become invented credit fees. Raw provider usage is retained. A missing usage object differs from an explicit zero, and cancelled/error attempts retain unknown usage rather than becoming free requests.

The API/database names `spent_credits` and `budget_credits` are retained for compatibility. New accounting treats these as token equivalents, not Abacus subscription credits or currency. Historical values remain unchanged and unclassified; new measurements are not silently comparable to old inflated units. Authoritative provider credits and estimates are null until supported pricing/usage reconciliation exists.

## Rebuild and inspect

```powershell
# All new retained experiments
npm run eval:dashboard

# Only chosen experiment directories; no provider requests
npm run eval:dashboard -- .zeus/evaluations/<first> .zeus/evaluations/<second>
```

The combined report is written to `.zeus/evaluations/dashboard/index.html`. Missing, empty, and corrupt inputs fail explicitly. Raw records survive report-generation failures. Historical score directories may be passed explicitly for inspection; their provenance is preserved, not upgraded to schema-v2 evidence. Append new trials to a fresh experiment, not an old historical score directory.

Phase 1 made no hosted calls. Phase 2 adds independently checked missions and a small native diagnostic; isolated execution, authorization graders, held-out cases, and a repeated baseline remain pending. Neither the legacy suites nor the native diagnostic are that baseline.
