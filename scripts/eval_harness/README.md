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

The orchestrator runs only `tests/unit/*.test.js`, `tests/missions/graders.test.js`, backend library tests, and `playwright.offline.config.js`. It does not include the existing live advanced E2E specs. The offline runtime requires an explicit HTTP/HTTPS loopback mock endpoint, uses a dummy key, and cannot fall back to a hosted provider. HTTPS fixtures use a checked-in development CA trusted only by test/evaluation builds in explicit offline mode. Each desktop launch gets a unique ignored workspace and test database. It does not delete or use manual conversations. Windows helpers and the test app run hidden.

Phase 2A adds [six mission contracts and validated graders](../../tests/benchmarks/missions/README.md). Their reference solutions and deliberately incorrect controls test the evaluator, not agent intelligence. Efficient live-model tests may be used separately when useful; ordinary offline regression remains repeatable without credentials.

Desktop coverage checks real bridge calls, streaming Chat/Responses usage, missing usage, empty replies, message ordering/reload, cancellation, shared Master/Worker/Verifier spend, approvals, and scripted mission trials. Attachment checks include distinct same-name files, exact image parts on both protocols, explicit connection identity, direct/helper delivery, follow-up inspection, invalid uploads retaining drafts, image-only sends, previews/reuse, cross-task IDs, changed bytes, explicit denials, reparse points, idempotency and cancellation. These mocks establish delivery behavior, not perception quality. Browser preview/session/replay remain for the browser repair packets. Existing Rust tests additionally cover recovery, migrations, media decoding/limits, routing, policy rules, message order, directive parsing and Python restrictions. This is regression coverage, not exhaustive production certification.

The Windows workflow in `.github/workflows/regression.yml` builds and runs these offline commands without provider secrets. Its remote execution has not yet been verified.

Stabilization adds actual global/task model-menu interactions, save/reopen, scoped render-fault recovery and failure on unexpected page errors. Large valid images exercise fresh HTTPS connections, the reported helper/manual/follow-up sequence and native exit/stderr capture; separate tests cover cancellation and full process restart. Normal approval cards are exercised for one-time declared writes and denied workspace escapes. These tests close observed coverage gaps; they do not establish universal task completion. The CI workflow also runs the large-image case against an optimized release build:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --release --locked --bin zeus-evaluation --features evaluation-runner
$env:ZEUS_OFFLINE_TEST='1'
$env:ZEUS_TEST_RELEASE='1'
node node_modules/@playwright/test/cli.js test --config=playwright.offline.config.js tests/regression/attachments.spec.js --grep 'large valid image'
```

## Native supervised mission diagnostic

The Phase 2 driver runs the production Rust library in a separate feature-gated `zeus-evaluation` executable. It uses fresh test data, normal permissions, and no inherited browser profiles/extensions. The live/mock provider choice is independent of policy; old suites explicitly request their legacy evaluation policy. Offline credential readiness uses only the validated mock configuration and does not touch the user's credential vault.

Native diagnostics support synthetic **D01** (data reconciliation) and **V01** (two supplied screenshots). Both grade JSON data without executing submitted programs. The user selected native supervised execution rather than preparing a VM. This shares the host's permissions; it is not an isolated benchmark or proof of adversarial safety.

```powershell
npm run bench:diagnose -- --dry-run
npm run bench:diagnose -- --live --mission D01 --model gpt-6-luna --effort medium --protocol responses
# Two separately bounded image configurations; each is one attempt:
npm run bench:diagnose -- --live --mission V01 --model gpt-6-luna --delivery direct
npm run bench:diagnose -- --live --mission V01 --model gpt-6-luna --vision-model gpt-6-luna --delivery helper --approval-control --followups
```

The default is a dry run with `gpt-6-luna`, medium effort, Responses protocol and the prepared synthetic supervisor. Live preflight checks exact IDs against the connection-labelled Abacus catalogue and refuses missing credentials/availability. Explicit bindings distinguish hosted/local IDs. There is one attempt per invocation and no automatic trial retry. D01 allows 10 requests; ordinary V01 allows 8; V01 `--followups` allows 18 across the artifact task and two additional text-only inspection turns. Each allows 8,192 output tokens/request, one request in flight, 1,000,000 token equivalents including reservations, 24 directives and five minutes. Previous smaller capped failures remain under their original configuration fingerprints. V01 `direct` uses the actor without a helper; `helper` explicitly routes initial images through the selected vision model. `--effort low|medium|high` and `--protocol auto|chat|responses` enter the fingerprint; a lower effort is not guaranteed to improve cost per completed task.

These are operational bounds, not an Abacus subscription-credit ceiling. Reserve estimates use serialized request bytes divided by three; actual reported usage can exceed the estimate. Unknown usage stops later dispatch rather than becoming a free retry. During bounded diagnostics, a provider failure is returned directly instead of being obscured by compatibility retries blocked by that safeguard.

The separate Zeus window uses normal approval cards. `--supervision synthetic` prepares a controller before dispatch that approves only bounded native reads/writes of declared files in the fresh synthetic workspace, once, independently of their correctness. It denies unexpected paths, arbitrary commands/scripts and network actions, records decisions, and creates no permanent rules. `--supervision manual` waits for the user/external reviewer instead. `--approval-control` installs a normal ask rule on the declared output, exercising an actual card even though correct workspace containment ordinarily permits the write. This is an active test controller, not the production Smart mode or an OS sandbox. The Windows extended-path containment bug is repaired and negative-tested; no benchmark bypass was added.

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

Matrix settings include role models, effort, limits, browser mode, permission policy, explicit provider bindings, protocol, declared image capability and delivery preference. Supported provider IDs are `abacus`, `gemini`, `xiaomi`, `local` and the compatibility value `runtime_selected`. Explicit IDs bind the selected connection; `runtime_selected` retains legacy resolution. Unknown provider IDs are rejected. These choices enter the configuration fingerprint and settings readback. Actual endpoint origins, connection IDs, roles and resolved route/protocol provenance are retained in accounting without credentials. A catalogue entry establishes availability, not image capability or intelligence.

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
