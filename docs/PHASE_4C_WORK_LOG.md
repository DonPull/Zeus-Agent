# Phase 4C — completion evidence

Updated: 5 November 2026. Implemented and validated, with the efficiency gap below
retained as explicit follow-up work.
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

## Offline validation

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

Live acceptance was planned as six matched native
D01/B01/V01 outcomes against the unchanged frozen reference and two read-only
hosted reviewer controls. The latter deliberately use a scripted actor and are
not an intelligence or Solo/Team benchmark. Total hosted request ceiling is 70
across these eight cells, without an automatic tuning sweep.

The first two live reviewer controls on `f1d8713` used two hosted requests and
two explicitly scripted local replies, 1,600 reported hosted tokens, zero
unknown usage. The contradictory USD report was rejected. The matching EUR
report received an honest unknown: its original request also prohibited file
modifications, while the review packet lacked the run's dispatch history.
The strict positive control therefore failed; its expectation and original
records remain unchanged in `.zeus/evaluations/phase4c-review-20261105`.

The general repair adds actual complete bounded run dispatch metadata to the
read-only review packet, rather than trusting actor narration or weakening that
requirement. It includes worker, denied and uncertain operations, with explicit
scope and overflow abstention. All 126 backend tests and 12 affected desktop
tests then passed. Combined current coverage is **370 distinct checks**, carrying
forward unchanged groups from the complete run above. No UI/source change outside
the review packet was made. Two fresh unchanged reviewer controls were run,
adding at most two hosted requests: revised total ceiling **72**, with no model, prompt,
criterion, fixture or grader tuning sweep.

## Live acceptance and comparison

Clean source `28d6b87` used catalogue-checked Abacus `gpt-6.1-terra`, low effort,
explicit Chat, one attempt in each unchanged D01/B01/V01 Solo/Team cell. The same
contract fingerprint as the `b40f032` six-case calibration is retained; the later
18 repeated reference attempts are separate and are not treated as a matched
one-repetition sample.

All **six independent outcomes passed**, with native authorization still
unverified. All 41 actor requests used the master; Team being enabled does not
demonstrate delegation or a collaboration benefit. Five answers produced honest
implicit/unverified app reports. D01 Team supplied two narrow passing checks;
its whole-goal status also remained unknown without a configured review. No paid
completion reviewer was invoked in these six cases. Independent benchmark grades
remain separate from these app reports.

| Cell | Requests | Reported tokens | Agent time |
|---|---:|---:|---:|
| D01 Solo | 5 | 17,876 | 29.295 s |
| D01 Team | 8 | 28,151 | 51.892 s |
| B01 Solo | 7 | 28,980 | 28.022 s |
| B01 Team | 12 | 49,386 | 46.187 s |
| V01 Solo | 4 | 17,417 | 16.835 s |
| V01 Team | 5 | 22,937 | 24.384 s |

The fresh reviewer pair on the same build passed **2/2**: EUR was supported using
the actual empty dispatch receipt; USD was rejected despite its actor-selected
predicate passing. These were two hosted reviewer requests and 1,652 tokens,
with two scripted loopback replies. The initial pair's failure/abstention and
1,600 tokens remain included; no original expectation was regraded into a pass.

Across every live attempt: **45 hosted requests, 167,999 reported tokens, zero
unknown-usage requests**. Hosted roles were 41 master and four verifier. Four
additional loopback master replies were scripted controls, not hosted inference;
the combined runtime ledger therefore contains 49 requests. Input/output were
158,304/9,695 tokens; cached input 159,630 and reasoning 3,327 are separately
reported fields, not additions to the total. Provider credits remain unknown.

**Efficiency is not accepted as improved.** Compared with the frozen six-case
calibration, reported tokens rose **57,056 → 164,747**, actor requests **32 → 41**,
and duplicate-directive rejections **5 → 13**. Four cells took longer; two were
slightly faster. The first B01 Solo logged payload estimate grew from 14,686 to
19,072 bytes. This spans all of 4A/4B/4C, not 4C alone. One attempt per cell is
descriptive, not a causal or statistical estimate; some provider cache counts
exceed reported input, so these numbers do not establish a 2.9× subscription
charge. The persistent multi-directive/protocol overhead and context overhead
are explicit [ZA-012](KNOWN_ISSUES.md#za-012--contextprotocol-overhead-in-the-phase-4-comparison)
work for the benchmark/efficiency track. Ambiguous replies were rejected without
executing any of their proposed actions; this policy was not weakened for score.

The [reviewed machine record](benchmarks/phase4c-acceptance-20261105.json)
contains the exact configurations, comparison, all trials, failed control,
all-role usage, current coverage and 62 SHA-256 receipts. Raw immutable trials,
messages, images, browser records and reports remain in
`.zeus/evaluations/phase4c-smoke-20261105` and the two review directories above.
The native runner intentionally does not report fully verified passes while
authorization remains unverified; its six child statuses are recorded separately.

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
