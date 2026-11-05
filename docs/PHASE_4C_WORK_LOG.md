# Phase 4C — completion evidence

Updated: 5 November 2026. Implementation complete; final validation in progress.
Companion to the [approved contract](PHASE_4C_COMPLETION_DESIGN.md) and
[current roadmap](IMPLEMENTATION_PLAN.md).

## Tangible differences and decisions

Work can now end with an expandable evidence card separating the agent's
completion claim, actual narrow checks, and an optional configured model review.
Original directives, failed checks and report updates remain in SQLite and the
full debug history. Ordinary conversational answers keep their existing flow.

| Previous approach | Implemented approach |
|---|---|
| A final answer recorded a completion claim only | Stable run/conversation/source-bound reports and human-input revisions |
| Tool exit or model-written criteria could look verified | File/result/browser predicates remain narrow facts; whole-goal status stays unknown without adequate independent review |
| No shared evidence contract | Optional criteria with source IDs and bounded native checks; no model-submitted test programs are executed |
| Missing or wrong outputs had no common correction path | A definite failed check allows one correction round; unknown/partial/blocked states do not create repair loops |
| No bounded read-only whole-goal reviewer | Explicit opt-in, configured verifier only, original human requirements, three-way judgment, 2,048 output tokens, one provider attempt and 30-second deadline |
| Worker answers returned prose alone | Return scoped evidence to the master without certifying the whole user goal |

No automatic Done/verified plan promotion, extra approval step, model fallback,
mandatory paid verifier call, or per-action completion check is introduced.
Review interruption/restart stays unknown. A request change during a review
marks its published snapshot stale. All original user messages and attachments
continue through Phase 4B's retention/retrieval path.

## Validation in progress

The focused 15 desktop checks passed, including ordinary replies, real artifact
and browser checks, one bounded correction, hidden worker reports, provider
failure, cancellation and restart. Ten focused backend completion tests and the
frontend build passed. Wide and narrow evidence-card screenshots were inspected.

An initial browser fixture used an unsupported locator field; 37 of 38 targeted
checks passed and that fixture failed honestly. Correcting the fixture to the
documented CSS locator made all ten initial completion checks pass. A subsequent
15-check completion/gallery run passed with the additional controls. The initial
failure was not repaired by relaxing the production check or grader.

The complete offline suite reports **369 checks passed**: 63 JavaScript controls,
37 mission/grader checks, 125 Rust tests, 23 browser-service checks, 118 desktop
checks and three private-desktop handoff checks. The frontend build and diff
check also passed. The full log is
`.zeus/evaluations/phase4c-regression-20261105.log`; native handoff receipts are
under `native-handoff-82fe0cf44a8944448a239e8a79831c04` in that evaluations folder.

The shell wrapper reported exit 1 despite all six groups passing. A separate
zero-exit Node process writing only synthetic stderr reproduces the same
PowerShell `*>` behavior; explicitly exiting with `$LASTEXITCODE` returns 0.
Both shell-probe logs are retained. The original child exit was not separately
captured, so this record does not relabel the wrapper as a zero-exit command.
No production code or test threshold was changed to handle the shell anomaly.

The remaining acceptance is six matched native
D01/B01/V01 outcomes against the unchanged frozen reference and two read-only
hosted reviewer controls. The latter deliberately use a scripted actor and are
not an intelligence or Solo/Team benchmark. Total hosted request ceiling is 70
across these eight cells, without an automatic tuning sweep. Exact source,
receipts, actual usage, failures and comparison limitations will be recorded.

## Limits and next milestone

Checks establish only their declared predicates. Model-chosen criteria and
expected values can omit or misinterpret a requirement; linking a human source
does not prove semantic coverage. A configured review remains model judgment,
not deterministic proof. Larger requirement packages deliberately abstain rather
than silently discard earlier constraints. Local file checks are bounded and
policy checked, not a new operating-system isolation boundary.

This slice does not redesign the existing executable worker verifier or grant
Smart permissions. After Phase 4, the next main deliverable is the full
12-core-mission Benchmark v1 before Phase 5, with browser speed/efficiency still
an explicit measurement track. Native previews, replay compression and chat
portability remain future work.
