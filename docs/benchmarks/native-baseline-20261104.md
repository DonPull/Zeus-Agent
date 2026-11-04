# Native development reference — 4 November 2026

Evaluated source: **`b40f032`**, clean, with exact Abacus `gpt-6.1-terra`, low
effort and Chat protocol. Models, task/grader versions, limits and environment
were frozen before dispatch. This is a three-mission development reference,
not the completed Zeus Benchmark v1, an isolated authorization assessment or a
general model/architecture ranking.

## Outcomes and resource use

The six-attempt calibration passed all six independent outcomes, using 32
requests and 57,056 reported token units. The separate repeated study used three
attempts per mission/configuration: **17/18 outcomes passed**, **110 requests**,
**156,550 reported token units**, no missing usage. All attempts remain retained;
the failed attempt contributes to both success rate and per-success resource use.

| Mission | Configuration | Outcomes | Actual role | Requests, all 3 trials | Reported tokens, all 3 trials | Median agent time |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| D01 reconciliation | Solo | 3/3 | Master only | 14 | 21,885 | 28.028 s |
| D01 reconciliation | Team enabled | 2/3 | Master only | 22 | 21,502 | 45.623 s |
| B01 browser workflow | Solo | 3/3 | Master only | 19 | 26,377 | 24.636 s |
| B01 browser workflow | Team enabled | 3/3 | Master only | 32 | 52,811 | 42.477 s |
| V01 image comparison | Solo | 3/3 | Master only | 11 | 17,169 | 26.535 s |
| V01 image comparison | Team enabled | 3/3 | Master only | 12 | 16,806 | 23.210 s |

The Team configuration enabled worker/verifier and passed effective-settings
readback, but the live model did not invoke either role. These rows measure the
current enabled configuration, not active collaboration. A separate controlled
desktop regression invoked two master, two worker and one verifier requests,
proving the driver can exercise those roles. Do not confuse that scripted
software result with the live results above.

The combined calibration and repeated studies used **142 requests and 213,606
reported token units**. Abacus subscription credits/currency remain unknown.
Raw input/output/cache/reasoning fields are preserved separately. Cached counts
can exceed reported input counts; do not add them blindly or interpret the
headline units as full context size. Provider cache state was not controlled.
Three repetitions per cell are descriptive and do not establish a statistically
reliable difference. The fixtures are public development cases, not held out.

Agent time uses the persisted run's start/end timestamps. Diagnostic duration
also includes startup, export and grading. Medians include failed attempts when
their duration is known; inspect statuses before interpreting a shorter time.
External grading is deterministic and made no model requests.

## Failures and performance findings

- `d01-team-3` failed with `MODEL_PROTOCOL_ERROR: repeated malformed directives
  exhausted recovery`, after four requests and 2,035 reported token units. No
  artifact was accepted. The app stopped the run rather than crashing. No retry
  or model substitution was used to replace this failed attempt.
- `d01-team-2` eventually succeeded after three replies containing two identical
  directive blocks. Those replies were rejected before execution. Four declared
  `list_dir` directives therefore do not mean four executed directory reads.
  The raw SSE envelopes are not retained, so generated syntax versus upstream
  transport duplication remains unestablished; do not blame model intelligence
  or change the parser speculatively without that diagnostic.
- `b01-team-2` passed after recovering from a failed fill that took **30,156 ms**
  of service time. `b01-team-3` recovered from a short failed click. All six
  browser trials passed independent server state/audit and browser-observation
  checks. Successful browser execution is still not fully optimized.

These findings prioritize response-format diagnosis, automatic state/plan
maintenance and a controlled browser-efficiency track. Do not shorten every
timeout, force ambiguous actions or weaken outcome checks to improve the score.

## Provenance and limits

[The compact JSON reference](native-baseline-20261104.json) records the frozen
contract, environment, cell statistics, selected synthetic per-trial metrics and
SHA-256 of every immutable raw trial. Raw conversations, desktop images, page
recordings, full manifests and failure evidence remain locally under:

- `.zeus/evaluations/baseline-calibration-20261104`
- `.zeus/evaluations/baseline-repeat-20261104`

Global authorization remains not evaluated on the native host, so there are
**zero verified authorization passes** despite the successful outcomes. Expected
runner exit codes are 2 for calibration (outcomes passed, authorization
unverified) and 1 for the repeated study (one genuine failure). Completed-resume
checks dispatched no additional attempts and saved these native exit receipts.
Derived reports were then rebuilt offline to show role usage and raw cache
coverage more clearly; immutable trials were not changed.

The full implementation regression passed 302 checks and the frontend build.
Final report-only changes passed the 56 unit checks again. No comparison against
a changed production architecture has yet been run; this is the reference for
that later comparison. The native profile still shares host privileges and
does not execute agent-produced programs in the evaluator. Coding, long memory,
recovery, research, held-out coverage and isolation remain unfinished v1 work.
