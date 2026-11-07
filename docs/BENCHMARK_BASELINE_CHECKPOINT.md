# Canonical measurement checkpoint — 4 November 2026

Status: implemented and measured. The six-attempt pilot passed all outcomes;
the separate repeated reference passed 17/18 outcomes. 302 full regression
checks and the frontend build pass. See [the reference report](benchmarks/native-baseline-20261104.md).
This is the bounded measurement slice before Phase 4, not the
complete 12-mission Zeus Benchmark v1 or an isolated safety certification.

Current follow-up (7 November): Phase 4A–4C foundations are delivered. The
[full-v1 delivery packet](BENCHMARK_V1_DELIVERY_PLAN.md) and
[work log](BENCHMARK_V1_WORK_LOG.md) track the twelve-scenario expansion,
isolated mission calibration and remaining live baseline work. The next-design
section below records the historical 4 November handoff, not the current phase.

## Tangible effect and decisions

This adds developer commands for comparing repeatable task outcomes and resource
use. It does not change normal chat, browser behavior or saved user models.

| Existing approach | This checkpoint |
| --- | --- |
| Separate manually launched mission diagnostics, hardcoded Solo | One frozen mission matrix, explicit Solo/Team configurations, fresh capped app process per attempt |
| Comparing aggregate history or a few selected successes | Matched task/configuration/build cells, every scheduled attempt retained, failures included |
| Whole-driver duration including collection/grading | Separate persisted agent-run duration and end-to-end diagnostic duration |
| Browser slowness judged from the live preview | Actual journal operations, failed waits, service execution/capture time and model-request counts retained alongside outcomes |
| Token totals treated as a possible proxy for subscription spend | Raw provider usage, missing-usage counts and actual reported credits kept separate; no invented conversion |
| Trial state lives partly in the running controller | Frozen plan plus per-attempt records; restart marks an unfinished attempt interrupted and never silently reruns it |

## Scope and research

Reuse the real production library, normal approvals, proven mission graders,
synthetic supervisor and managed browser observer. Extend the existing driver;
do not introduce another agent implementation or the deprecated self-improvement
loop. Team means enabling the existing worker/verifier machinery, not forcing
delegation or redesigning it. Report actual role request counts so an unused
worker cannot be mistaken for demonstrated collaboration.

The current native-supervised profile remains authorized for bounded diagnostics.
It shares host permissions. Data/vision outcomes and controller-owned portal
state can be graded without running submitted programs. C01/C02/D02 executable
submissions remain excluded until a separately approved isolated grader exists.
Global authorization stays not evaluated; the headline measurement is successful
execution plus independently checked outcome, separately from a verified pass.

The task/trial distinction, retained transcripts, independent outcomes and
repeated trials follow [Anthropic's evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).
Keep actor-produced programs out of native grading; [Harbor's separate-verifier
design](https://docs.harborframework.com/tasks/separate-verifier) supports the
later isolated execution design. Neither source establishes containment on this
host. These references were checked on 4 November.

## Frozen workload and models

Use existing unchanged B01 (ticket workflow), D01 (reconciliation), and V01
(actual image comparison). These measure a small development portfolio; no
general-intelligence or held-out claim is appropriate. Wordle remains an optional
live-site diagnostic, not the main score or a dedicated agent subsystem.

Candidate economical configuration: exact Abacus `gpt-6.1-terra`, low effort,
explicit Chat protocol, identical acting model in Solo and all enabled Team roles.
Watcher is disabled in both; V01 uses the same direct-image configuration in both.
Check exact catalogue availability before inference and retain protocol/image
failures rather than substituting a model mid-experiment. The user's saved role
settings remain untouched. If calibration fails, record that cell and propose a
new configuration instead of repeatedly upgrading models to make it pass.

The [Artificial Analysis leaderboard](https://artificialanalysis.ai/leaderboards/models),
checked on 4 November, lists Terra low as an economical, fast candidate. This is
shortlist evidence, not Zeus performance or Abacus subscription-credit pricing.
[Abacus's API documentation](https://api.abacus.ai/help/route-llm/chat-completions)
requires using the exact catalogue ID; explicit Chat avoids an unmeasured
protocol switch. The initial trial is also the real adapter capability check.

Calibration: **six attempts**, one per mission/architecture cell, no automatic
retries or architecture/prompt tuning between attempts. Per-attempt ceilings:
D01 10 requests, V01 8, B01 16; 8,192 output tokens/request, 24 directives,
one in-flight request, 1,000,000 reported/estimated token units, five minutes.
That is at most **68 requests** across calibration. These are operational bounds,
not a provider-credit ceiling; interrupted usage may be unknown.

After auditing calibration and its real cost/validity, freeze a separately
identified repeated baseline: three attempts per cell (18 total, at most 204
requests under the same per-mission ceilings). Do not silently roll calibration
trials into the baseline or automatically spend the larger envelope if the
pilot cannot establish valid measurements. No broad model sweep is included.

## Persistence and comparison rules

- Stable ordered attempt IDs include mission, architecture and repetition.
  Alternate Solo/Team order across repetitions to reduce order bias.
- Each attempt launches a fresh app/database, task workspace, portal state and
  dedicated browser profile. Share no prior task conversation.
- Persist the intent before starting the child. An interrupted active attempt
  becomes an explicit interrupted/missing-usage record on resume. Remaining
  never-started attempts may continue; retrying a failed attempt is a new study.
- Freeze source commit/diff identity, task/fixture/grader hashes, effective
  runtime settings, execution profile, browser settings and limits. Reject
  resume if these changed. Record runtime setup/browser versions when available.
- Keep all six/18 scheduled attempts in the denominator, including failures,
  infrastructure errors, cancellations and interruptions. Unknown usage makes
  aggregate cost incomplete, not zero. Report coverage counts.
- Compare identical mission/configuration contracts between builds; reject
  changed fixtures/graders/model bindings/limits rather than attributing their
  difference to code. Solo/Team comparisons explicitly differ in enabled roles.
- Report successful outcomes, verified passes, execution failures, role use,
  latency and known token use separately. Cost per successful outcome includes
  resources spent on failed attempts. With no success it is unavailable.
- Three repeats are descriptive, not evidence that small differences are
  statistically reliable. Keep raw paired task results visible.

## Acceptance and delivery

Implementation validation on 4 November: **302 full offline checks passed**
(56 JS, 37 mission/grader, 88 Rust, 23 real Python browser-service, 95 desktop,
3 private native handoff), plus frontend production build and diff checks.
The final unit run also covers the real driver's extra runtime provenance label
without weakening source-identity comparison. The new Team integration exercised
two master, two worker and one verifier requests and an independently checked
artifact; these controlled replies are software evidence, not intelligence.

Prove real Team delegation, worker output, verifier usage and role settings
through the bridge with controlled model replies. Prove plan/resume invariants,
missing-record handling, comparison mismatch rejection, unknown-cost behavior
and failure-inclusive metrics using deterministic tests. Existing one-off
diagnostic commands and immutable trial formats remain compatible.

Run relevant unit/mission/desktop regressions, build the app, then commit before
live calibration so its source identity is reproducible. Use hidden test windows
and headless managed Chromium; notify the user before any foreground experiment.
Retain all pilot attempts and publish a compact synthetic summary after review.

## Browser speed and efficiency follow-up

This is explicit follow-up work after measurements exist. Use a resettable
multi-step browser workload alongside B01, with readiness/hydration, repeated
operations and recovery cases. Compare requests, tokens, total agent time,
failed/uncertain operations, service/capture time and retained outcome quality.
Evaluate text/visual observation volume, batching, redundant inspections,
speculative waits and recovery strategy individually. Preserve postcondition
checks and successful state continuity; no blanket shorter timeouts or disabled
verification. A faster replay or preview is not a faster agent. Revisit this
before claiming browser performance is optimized.

## Delivery and next design

Measurement code was committed/pushed as `b40f032` before live dispatch and
kept clean throughout both studies. The pilot used 32 requests/57,056 reported
token units; the 18-attempt repeated reference used 110/156,550, with no missing
usage. Every failed attempt remains retained. Native authorization remains
unverified; subscription credits remain unknown. Team roles were enabled but
not used by these live runs. The final derived report explicitly shows role
requests and raw cache/reasoning fields; this did not change any raw trial.

The next [focused Phase 4 design](PHASE_4_TASK_STATE_DESIGN.md) proposes a
response-format diagnostic and then automatic durable task checkpoints before
separate memory/compaction/completion changes. It is for alignment, not an
unreviewed runtime rewrite. Broader v1 missions, executable grading isolation,
held-out coverage and genuine collaboration measurements remain unfinished.
