# Full Benchmark v1 delivery

Updated: 6 November 2026. User authorized the full benchmark after Phase 4C.
This is the active delivery packet for the canonical roadmap's 2D/2E milestone.
The full milestone remains in progress until the acceptance gates below pass.

## Tangible differences and decisions

This work expands developer measurement from six authored missions and three
native live missions to twelve runnable, independently graded missions. It
retains actual outcomes, failures, original artifacts, all-role usage, timing,
environment identity and matched build/configuration comparisons.

| Existing approach | Full v1 decision |
|---|---|
| Six contracts; three native live paths | Twelve core contracts with references, alternatives and plausible negative controls |
| Coding submissions exported but deliberately not executed on the host | Execute submitted code only through a validated isolated grading adapter; missing isolation is an explicit unavailable/error result |
| Memory controls and H01/H02 are separate probes | Wire actual M01 requirement changes/compaction and M02 controller-observed restart/side-effect recovery |
| Browser task evidence covers B01 | Add actual CSV download, changed-requirement workflow and restart evidence from controlled fixtures |
| Mixed historical runners | Add a versioned core-v1 manifest/driver; preserve existing native records and contracts |
| Aggregate token counts alone | Preserve raw usage/cache semantics, actual role use, context/payload estimates and protocol-repair overhead |
| Completion claims can be confused with success | Independent evaluator computes outcomes; execution, outcome and authorization remain separate |

No production agent prompt, permission, browser or Team redesign is included.
Any independently reproduced product defect gets its own narrowly tested repair
and a new source identity. No automatic patch/tune/retry loop or model sweep.

## Portfolio

| Mission | Actual capability | Required evidence |
|---|---|---|
| B01 | Update the correct ticket | Protected portal state/audit plus browser interaction |
| B02 | Filter orders and export CSV | Exact boundary/status/currency rows, real browser download and independent total |
| B03 | Revise a draft before final submission | Real later user correction, preserved draft and one correctly revised submission |
| C01 | Repair nested JSON flattening | External behavioral probes and preservation cases |
| C02 | Filtering/pagination API | External HTTP requests and preserved old routes/input |
| C03 | Persistent accessible task dashboard | Actual rendered-page filtering/editing/keyboard/reload probes; screenshots, polish ungraded |
| D01 | Invoice/payment reconciliation | Independent integer-cent calculation and unchanged inputs |
| D02 | Idempotent SQLite migration | Fresh external database and repeat/fresh-input probes |
| M01 | Project continuity after correction/distraction | Latest requirements, retained earlier constraints, actual compaction receipt and originals |
| M02 | Exactly-once recovery after restart | Controller-observed committed effect before restart and exactly one later effect |
| R01 | Research with corrected evidence | Correct structured claims/recommendation and resolving supporting source spans |
| V01 | Compare original image facts | Actual supplied pixels, changed quantity and independently calculated total |

The six existing 1.0 contracts remain unchanged. New contracts explicitly state
file formats, allowed effects and criteria before any live grading. Core tasks
are public development tasks, not a secret held-out set or an external benchmark.

## Execution boundary discovery

Read-only inspection found Windows 11 Pro 23H2 (22631), firmware virtualization
and SLAT enabled, about 13 GB free memory, no WindowsSandbox executable, no
vmcompute service, no Docker/Hyper-V/VirtualBox tool and no ready WSL runtime.
The current process is not administrator. No Windows feature was enabled.

Prepare a reviewable Windows Sandbox setup using supported .wsb configuration,
with narrowly scoped input/output mappings, no personal profile or repository
mapping, clipboard/device redirection disabled and explicit egress control.
Actor execution and executable grading need separate fresh environments, with
trusted expected results and fixture state outside the acting environment.
Network-off file transport is a candidate to avoid exposing LAN/credentials;
validate the actual transport and bounds before accepting an isolation receipt.
Do not equate test folders, a second process, Python hooks or a claimed profile
name with an operating-system boundary.

Enabling the optional Windows component requires an administrator and may need
a reboot. Prepare and test configuration/bundles first, then request the concrete
machine change. Never restart the PC automatically. Tests that display windows
or need focus must be announced and scheduled with the user.

Microsoft documents the [.wsb configuration](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)
and states that the newer [Sandbox CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)
starts with Windows 11 24H2; this host's 23H2 plan must not depend on that CLI.

## Delivery sequence and acceptance

1. **2D1 contracts/graders:** author the missing six contracts, controlled web
   fixtures and independent graders. Every reference passes; distinct valid
   alternatives pass where applicable; wrong IDs, stale requirements, duplicate
   effects, wrong dates/totals/citations, fake UI reports and edited visible
   tests fail. No hosted inference or untrusted host execution.
2. **2D2 runtime/isolation:** wire all twelve into the real bridge, including
   later user turns, actual downloads, forced compaction and committed-checkpoint
   restart. Prepare and validate isolated actor/export/grader execution. Prove
   foreign paths, untrusted programs, quota/deadline/cleanup failures and tamper
   attempts cannot become passes. Record precise policy-channel coverage.
3. **2D3 frozen pilot:** produce a dry-run manifest with exact economical model,
   roles, environment, caps and mission identities. Catalogue-check before any
   inference. Run one-attempt calibration/pilot in stages with retained failures;
   audit usage before committing to the repeated run. No paid run is authorized
   merely by running ordinary software CI.
4. **2E repeated baseline:** freeze three attempts per mission and matched
   Solo/Team configurations, then run/resume without tuning or deleting failures.
   The complete 12 x 3 x 2 matrix is 72 agent attempts, not 72 provider requests.
   Its actual request/token envelope must be generated and reviewed after the
   pilot; this document does not invent a subscription-credit conversion.
5. **2E report:** prove comparisons reject mismatched fixtures/graders/settings,
   report all-scheduled outcomes and raw usage, disclose actual worker activity,
   retain interruptions/unknowns and review committed summaries for private data.

Current status: repository clean at start on df6e43d; environment inspection
complete; twelve contracts authored and 70 grader controls passed. Runtime
integration/isolation is next; see the [work log](BENCHMARK_V1_WORK_LOG.md).
Full v1, repeated measurements and isolation are
not delivered yet. Preserve progress on disk and update this section at each
validated checkpoint before any reboot or interruption.

## Efficiency track

Keep ZA-012 visible: across the previous matched six-cell comparison, requests
rose 32 to 41, reported tokens 57,056 to 164,747 and ambiguous multi-directive
rejections five to thirteen. Capture per-call payload/context estimates and
recovery overhead while implementing v1. Provider cache semantics prevent a
direct credit-ratio claim. Do not optimize against the few reference cases or
execute ambiguous replies to improve a score. Browser observation/batching and
readiness remain measured follow-ups with unchanged outcome checks.
