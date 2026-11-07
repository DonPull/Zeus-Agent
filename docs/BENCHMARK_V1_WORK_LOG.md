# Full Benchmark v1 work log

Updated: 6 November 2026. Full milestone in progress; no full capability baseline
or validated isolation is claimed yet. See the [delivery plan](BENCHMARK_V1_DELIVERY_PLAN.md).

## 2D1 contracts and grader controls

All twelve mission contracts are now authored. Existing B01/C01/C02/D01/D02/V01
contracts and fixtures were preserved. B02/B03/C03/M01/M02/R01 add deterministic
data, controlled web fixtures, reference outputs and independent outcome checks.

Decisions and tangible changes:

- B02 requires actual downloaded bytes and external browser evidence, alongside
  exact date/status/currency rows and totals. Correct fabricated files are insufficient.
- B03 retains protected draft/submission audit history across a correction
  checkpoint; restoring a correct final state cannot erase early/duplicate submissions.
- C03 gets real rendered-page probes for loading fresh input rows, filters,
  persisted editing/toggling, keyboard behavior, empty input and narrow layout.
  Two independently structured reference implementations pass. Screenshots at
  1100 and 420 pixels were inspected. No subjective polish score is invented.
- M01 grades latest requirements plus retained earlier constraints and separately
  requires controller evidence of compaction and original-source retention.
- M02 separately requires controller restart evidence and fixture-side exact-effect
  audits. Synthetic unit traces are labelled controls, not real app restart results.
- R01 checks current facts, effective dates, region/price constraints and resolving
  supporting line spans. An unchanged fact can still cite its older valid source;
  superseded facts and unapproved announcements cannot replace current evidence.
- Plain actor JSON cannot substitute for controller evidence handles. Unknown
  browser/history/restart observations remain unmeasured. Host execution of an
  arbitrary C03 submission remains unavailable without the isolated grader.

Validation: `node scripts/run_regression.js --missions` passed **70 controls**
(37 prior and 33 new). Exit code 0. Machine-readable receipt:
`.zeus/evaluations/regression-receipts/d89698f3-539a-418e-b2ff-4cafaad653d5.json`.
The reference dashboard screenshots remain in
`.zeus/evaluations/core-v1-dashboard-reference`.

The complete offline regression then passed **403 checks**: 63 JavaScript,
70 mission/grader, 126 Rust, 23 browser-service, 118 desktop and three private
desktop handoff checks. All six child stages and the launcher recorded exit 0.
Full receipt: `cbda1d8c-5edf-41d7-b42a-e707feb9a587.json` in that receipt directory.
The frontend build also passed. The
[reviewed validation record](benchmarks/core-v1-contracts-20261106.json)
retains the source snapshot and receipt/image hashes. This is software/grader
validation, not a twelve-mission live capability result.

The regression launcher now persists stage start/end/actual child exit metadata
under `regression-receipts`. Interrupted runs retain running/unverified receipts;
PowerShell stderr-redirection status cannot replace actual recorded child status.
No provider keys or environment secrets are logged. These checks use only trusted
authored controls; no hosted inference or agent-submitted host execution occurred.

## Current execution-environment finding

Initial read-only checks found Windows 11 Pro 23H2 with firmware virtualization
and SLAT, but no enabled Sandbox/VM runtime. The later approved UAC step below
enabled the component. No automatic restart, account or network-rule change was
made. Actual .wsb guest execution and the isolated actor/grader transport still
need validation; the newer 24H2 Sandbox CLI cannot be assumed on this host.

## 2D2 real workflow controls and measurements

Six new scripted real-app cases cover B02/B03/C03/M01/M02/R01. Combined with the
existing six native mission cases and actual B01 browser controls, every core
mission now has a production-bridge software path. These are mocked-response
runtime checks, not twelve live capability outcomes. They use ordinary approvals,
exact predeclared script/file hashes and protected fixture state, with no hosted
requests or arbitrary submitted-program execution on the host.

Decisions and changes:

- Single-message execution now accepts a bounded external workflow controller.
  B03 sends its actual later correction; M01 injects declared untrusted tool
  distractions, triggers actual compaction and checks original-message hashes.
- M02 version **1.0.1** explicitly pauses after the confirmed note, terminates
  Zeus, reuses the exact owned workspace in a new process and sends the second
  user turn. The fixture audit must still show Open and exactly one note before
  restart. A correct final state reached before restart fails this receipt.
  This public-contract clarification occurs before any live core evaluation;
  uncertain acknowledgement/mid-command termination remains a separate stress
  case, not a silently claimed part of M02.
- Restart carries forward the original request/token/directive/time allowance.
  Unknown prior usage or exhausted limits prevent further dispatch. Actual
  root-run durations, workflow wall time and process-local debug snapshots are
  retained across the restart.
- Browser mutation observations are joined with protected fixture audit and
  real native download records. Source labels preserve managed-controller versus
  external-Playwright provenance; actor-provided JSON cannot substitute.
- Payload estimates and format-rejection counts support ZA-012. They remain
  partial bounded-log observations, not wire/token/credit counts or model latency.
- Executable grading still requires an exact trusted reference hash on the host.
  C03 follows the same guard as C01/C02/D02. No planned profile name bypasses it.

The first workflow run retained B02's missing CSV failure. The download itself
succeeded, but its returned Windows path reached MAX_PATH and ordinary Python
file I/O could not reopen it. Returning the verified handle's canonical extended
path fixes that general product defect; B02 now reads/copies the real bytes and
the existing browser transfer ownership/preservation regression passes.
The initial receipt `ed924e62-bfb0-470c-988b-0ab874c423cf.json` and intermediate
`b72e4451-d344-4084-99b0-376d334d7d80.json` remain under regression-receipts.
The latter retained an obsolete string-prefix assertion, repaired by comparing
canonical paths in the same Windows namespace.

The complete regression passed **411 checks** (65 JavaScript, 70 grader,
126 Rust, 23 browser service, 124 desktop and three private-desktop handoff).
Receipt: `36a67dcc-002b-450c-a2a6-f7273d0f04aa.json`. The frontend build passed.
Additional candidate-planner, bounded Sandbox reader and per-process measurement
controls were then added and receive a separate final validation receipt below.

Final focused validation passed **75 JavaScript + 70 grader + 14 desktop
checks**, receipt `4405608b-effc-47d4-91a8-7c43e028e112.json`. The final CLI
exit controls also passed in the 75-unit receipt
`4feef9ec-c154-4795-b1aa-071636b8b7b3.json`. Combined distinct coverage is
**421 checks**; this is the full run plus focused follow-ups, not one 421-check
invocation. [The reviewed record](benchmarks/core-v1-runtime-20261106.json)
retains tested code hashes, all receipt hashes and the six latest scripted
workflow records. Hosted inference requests: **zero**.

## Prepared isolation probe and candidate manifest

The preparer generates exactly two disjoint mappings, disabled networking/device
redirection, Protected Client and 4096 MiB memory. The private host sentinel is
unmapped. Its guest script checks boundaries without Python, Node or a model.
The host reader rejects changed hashes, identity mismatches, redirected paths,
device names, extra output and oversized bytes. Even consistent guest JSON
reports `isolation_validated:false`. Actual VM lifecycle, disposal, actor runtime,
separate grader, bounded file transport and resource controls are still open.

`core_benchmark.js` defaults to one D01/Solo pilot candidate. Its repeated
candidate has twelve missions, three repetitions and both architectures (72
attempts), alternate ordering and equal per-mission limits. The reference is
Abacus `gpt-6.1-terra`, low effort, explicit Chat. Model availability/image
delivery require actual preflight later. Team enables the existing roles; actual
role usage must still be measured. These provisional maxima are **not a live
budget approval** or a forecast; the command cannot dispatch inference and
`--live` fails. Pilot results must inform the reviewed repeated envelope.

## Feature setup history

The user confirmed availability for the administrator/UAC setup on 6 November.
The reviewed `scripts/eval_harness/sandbox/enable_windows_sandbox.ps1` defaults
to plan-only; its explicit enable mode uses `-NoRestart`. The first plan receipt
is `sandbox-setup/98647486-be6e-44cc-a6d2-6edcde9450bb.json` under evaluations.
The component enable step succeeded with status **restart_required**, exit 2,
administrator true, before state Disabled, changed true and automatic restart
false. Setup receipt: `639edc67-8b57-46f3-8b82-3d63b110802b.json`.
The initial shutdown/boot still reported restart pending. A subsequent normal
restart activated Sandbox and the hypervisor; the read-only snapshot reports
last boot `2026-11-06T13:44:54.5000000Z` and no pending component restart.
No automatic reboot was performed.
The pushed prerequisite checkpoint is `053a4e0`, following the validated 2D1
checkpoint `70af36e`. The workflow/planning additions above form the completed
software checkpoint documented by the reviewed validation record.
The earlier prepared, unlaunched probe was
`.zeus/evaluations/sandbox-sessions/c7b6250a-de19-415b-90bf-67d58eccce3e`.
It contains no live credentials or personal browser profile. Keep this progress
on disk through the required manual Windows restart; no process state is needed
to resume implementation.

## Actual guest boundary and lifecycle probes

The user requested another check after the normal restart and authorized
continuing. One initial guest control passed its six observations and was
cleaned up. Two subsequent protocol-2 guests passed seven checks each: input
readability, read-only input, unmapped host-file denial, no active non-loopback
network adapter, writable bounded output, a different computer from the host
and no leftover unmapped guest marker.

The two Windows container IDs differ. Their guest computer name is the same
base-image name, so computer-name changes are not used as evidence of freshness.
The marker and controller-observed container identities provide that evidence.
The controller captured launcher/client PID plus exact process-handle creation
time and closed only those processes; the launcher exited after the client was
terminated. It never persists raw client command lines or guest account passwords.
A negative control proves an unrelated live process is left running.

The initial manual client snapshot used CIM's rounded creation time. Its
sub-microsecond precision differed from the process handle; the controller now
uses exact handle times for both proof and cleanup. The first direct script
invocation was rejected by local execution policy; explicit process-only
`RemoteSigned` runs the reviewed script without changing the machine policy.
Failed/partial artifacts remain retained. No foreign process or system-wide
VM service was terminated.

`hcsdiag` enumeration was unavailable to the normal user. Independent HCS
disposal remains unknown; host-process exit plus a subsequent fresh guest is
partial lifecycle evidence, not a claim that all isolation/resource gates pass.
Guest inventory reports Windows build 22621, PowerShell 5.1, no Python/Node
commands and no installed WebView2 runtime. The actor/grader bundle remains next.

The [reviewed probe record](benchmarks/sandbox-probes-20261106.json) retains the
two actual receipt/result hashes and source hashes. The 77-unit follow-up passed,
receipt `121b6e9f-6b9b-4289-8925-865b50525a22.json`. Combined distinct software
coverage is now **423**, plus the two actual OS guest probes. No product runtime
or UI source changed in this checkpoint, so the earlier complete regression
remains applicable with these focused follow-ups. Hosted inference: **zero**.

Microsoft's [experimental MXC backend](https://github.com/microsoft/mxc/blob/main/docs/backends/windows-sandbox/windows-sandbox.md)
was inspected as an alternative. Its bridge uses guest networking and a guest
firewall, whereas this packet fixes networking disabled at the .wsb boundary.
Retain the existing OS-supported configuration while implementing bounded file
transport; no new sandbox SDK or network policy was installed.

## Pinned guest runtime checkpoint

The default guest has no installed Python, Node or WebView2. A public dependency
bundle now pins Python 3.11.0, Node 22.13.1, Playwright 1.62.0, Chromium
151.0.7922.34, WebView2 157.0.4341.42 and Microsoft C++ libraries 14.51.36247.0.
Microsoft's cabinet metadata, download hash and executable signature are retained;
the public bundle has a complete per-file hash inventory. No installer ran on
the host. No user profile, credentials or repository mapping is included.

Decisions compared with the earlier preparer:

- Metadata-only preparation now stages and tests an actual portable runtime.
- Copy the fixed WebView2 runtime to guest-local storage before executing it;
  [Microsoft documents that UNC/network execution is unsupported](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution).
- Use a guest-only, per-executable HKLM debugging policy. The initial environment
  switch was ignored by the elevated Sandbox account under WebView2 157;
  [Microsoft explains this security change](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645).
  Host registry and network configuration are unchanged.
- Include the signature-verified app-local C++ dependencies required by greenlet.
  The initial portable Python omitted MSVCP140.dll; the retained traceback and
  binary import table identified the missing dependency.
- Keep the small trusted control scripts separate from the readonly dependency
  bundle. Edits to diagnostics no longer require recopying 1.48 GB on the host.
- Retain failed guest observations even when inspection fails; successful app
  completion alone cannot satisfy the browser navigation/cleanup check.

The final fresh guest `bc91bc3e-0eae-4c19-b1b8-57bd1b38163a` passed all eight
checks, including actual HTTP 200 navigation to its synthetic fixture, the real
Zeus bridge/Python/managed browser, exact dependency versions, two mock requests,
known usage and zero remaining owned browser processes. Owned Sandbox client and
launcher exited. Independent HCS disposal remains unknown. An earlier repaired
runtime probe also passed; all preceding runtime failures remain on disk.
These are scripted runtime observations, **not agent capability outcomes**.

Final focused validation passed **79 JavaScript + 70 grader checks**, receipt
`0abfaf8b-d751-4531-80f3-d61e7dfd5741.json`. Two restricted validation attempts
retained Windows temp-path EPERM failures; the explicit approved unrestricted
rerun passed. No production app/UI code changed. Combined distinct coverage with
the earlier complete run is **425 checks**, plus the actual OS guest probes.
The [reviewed runtime record](benchmarks/sandbox-runtime-20261106.json) retains
the successful and failed probe hashes, dependency identity and tested code hashes.
Hosted inference: **zero**. The full benchmark remains in progress.

## Bounded synthetic file transport checkpoint

The real Zeus guest now talks through loopback HTTP proxies and bounded file
messages to a host-controlled fake model provider and website fixture. Networking
remains disabled at the .wsb boundary. The host broker has no provider key,
external HTTP client, shell-command or arbitrary-URL interface. This checkpoint
does not enable paid dispatch or claim all twelve isolated workflows are wired.

Decisions compared with the guest-local smoke:

- Move synthetic provider/fixture handling outside the acting environment and
  retain a separate, unmapped host receipt for every dispatched request.
- Bound the exchange to 32 messages, 1 MiB decoded bodies, 2 MiB files and 16 MiB
  aggregate bytes; accept only the two declared synthetic routes and exact
  message fields. Preserve nonces, byte hashes and honest failure counts.
- Reject changed/replayed identities, unrelated routes, oversized/extra files
  and incomplete/corrupt responses. A publication failure never repeats the
  provider operation.
- Actual readonly WSB mappings held persistent rename locks. Precreate empty
  response slots before launch and publish length/checksum/completion frames
  once into those files. Partial reads remain pending rather than accepted JSON.
- Retain the broker's native process handle before exit, refresh its state and
  check both completion and actual exit code. Cleanup uses exact owned handles.

Two repaired positive guests passed all nine checks. The final one is
`d94ccb98-e7ca-4257-98c8-154fcbb01523`: two host-observed mock calls, one fixture
request, unchanged exchange hashes, exact runtime versions, a successful real
browser navigation and zero remaining owned browser/broker/Sandbox processes.
The negative guest `9eb63ef5-d0db-40ce-9295-eded9bf7e571` bypassed the client
validator and wrote an undeclared external URL. The actual host rejected it
before any provider/fixture handler ran; the expected failed probe and clean
teardown are retained. It is a negative control, not a successful model mission.

Earlier rename failures and the completed-transport/missing-exit-code rejection
remain in their original session directories. The controller did not convert
them into passes. The [reviewed transport record](benchmarks/sandbox-transport-20261106.json)
retains their receipt hashes and the final source/validation identities.
Final focused validation passed **87 JavaScript + 70 grader checks**. Combined
distinct coverage with the earlier complete run is **433 checks**, plus the
actual guest probes. Production app/UI code is unchanged. Hosted inference:
**zero**. Independent HCS disposal, CPU and writable-mapping disk quotas remain
unvalidated. No full isolation certificate or full benchmark baseline is claimed.

## Separate executable-grader runtime controls

The user authorized continuation with 11% Codex allowance remaining. This slice
was kept restartable on disk and uses no model inference.

Decisions compared with the earlier runtime checks:

- Run the existing C01/C02/C03/D02 outcome graders in a fresh guest, separate from
  the earlier Zeus actor guest. Stage only a bounded readonly packet of trusted
  grading code, public fixtures and exact known controls; never map the repository.
- Exercise a reference, a distinct valid alternative and a failing control for
  each executable mission. A success label cannot replace exact source identity,
  required reference criteria or the expected negative result.
- Retain complete assessments as bounded JSON with a verified hash. The host
  reads data only and compares it with its own expected-control manifest.
- The dashboard grader now imports the existing `playwright-core` package and
  explicitly selects full Chromium, matching the pinned managed-browser runtime.
  Its outcome probes are unchanged. The grader identity changes, so future
  comparable baselines must freeze this version rather than mix old/new graders.
- This is a known-control runtime check. It does not accept generated programs
  or relax the native host execution guard, and it cannot unlock core live runs.

Fresh guest `105fef1a-562a-4622-8823-32d8985e3fb7` passed all nine boundary/
grading/evidence checks. All twelve outcomes matched: eight valid implementations
passed and all four negative controls failed as expected. Its container identity
differs from the preceding actor guest and its guest-only marker was absent on
entry. Owned Sandbox client and launcher exited. Independent HCS disposal is
still unknown.

The final focused run passed **89 JavaScript + 70 grader checks**; receipt
`1a3ef51f-5090-4242-bdd9-8c54a666b07d.json`. The initial unit assertion omitted
the deliberately staged `controls/` namespace and was corrected; its failed
receipt `0b6d1d91-0e1d-41f1-b3a1-961fe0b7b281.json` remains retained. Combined
distinct software coverage with the earlier full regression is **435 checks**,
plus actual OS guest probes. No production app/UI code changed. Hosted inference:
**zero**. [The reviewed record](benchmarks/sandbox-grading-20261106.json) retains
source, packet, evidence, validation and lifecycle hashes.

## Protected generated-submission grading

Delivered after `1397eae`, with zero hosted inference. Executable mission exports
can now be graded in separate fresh guests through an explicit developer CLI
and the existing mission runtime adapter. The normal host execution guard and
core live-driver gate remain in place.

Decisions compared with known-control grading:

- Snapshot declared exported bytes as data; never execute submitted programs on
  the host. Remove reference solutions from the generated-submission packet.
- Separate candidate programs from the trusted grader using a disposable guest
  standard account and protected private/runtime directories. Verify actual
  identity, ACL and controller-process access rather than trusting environment
  variables or a profile label. No host accounts, policies or credentials change.
- Start candidate Python behind an activation gate in an owned Windows job.
  Verify exact exit codes, normal descendant cleanup and timeout cleanup; disable
  the account and check its process-token SIDs before accepting the assessment.
- Actual experiments found mapped input readable and output writable by the
  candidate account. Replace trust in output JSON with a fresh Ed25519 key pinned
  by the host before candidate startup and signed job/nonce/packet assessments.
  Runtime files initially remained writable too; reset only the copied guest
  runtime's ACLs and repeat the actual boundary check.
- Keep complete assessments in Node JSON. Send metadata-only inspection to
  PowerShell: a legitimate empty JSON property name caused a real failed launch
  receipt even though grading completed. Preserve that failed receipt rather
  than accepting it retroactively after fixing the reader.
- Fingerprint grader code, helpers, contracts and fixtures independently of
  reference implementations. Future comparisons must freeze the new identity.

Four generated-submission reference controls passed (C01/C02/C03/D02), and all
four corresponding faulty submissions failed. A separate submitted program read
the visible job identity and replaced `probe-result.json`; the host rejected it
with `Missing signed grading result`, retained the failed run and cleaned up its
owned processes. A final fresh C01 check passed after the last identity-guard
change. The account probe also verified private-file/runtime/controller-memory
protection and exact exit/descendant/timeout behavior. These are runtime and
grader controls, **not model intelligence outcomes**.

Full regression passed **442 checks**: 96 JavaScript, 70 mission graders, 126
Rust, 23 browser-service, 124 desktop and 3 private-desktop handoff checks.
Receipt: `3bc7206e-ab0b-4f4c-b1bd-74f9ae3e79ef.json`. Final focused unit validation
passed all **96**, receipt `bafb1347-104a-4f43-a5f8-de2b75790ee4.json`, including
the actual-identity guard and empty-property-name inspection regression.
Production app/UI code is unchanged. The
[reviewed record](benchmarks/protected-submission-grading-20261106.json) retains
positive/negative/forgery results, earlier failures, source and receipt hashes.

This is not a full isolation certificate: independent HCS disposal, CPU and
writable-mapping disk quotas remain unvalidated. No full core live baseline or
paid dispatch is enabled. The user interruption did not lose source or evidence.

## Host provider relay prerequisite

Delivered after `f7a24a3`. The fixed Abacus Chat relay and its file-exchange
adapter are implemented; isolated actor integration remains pending. It reads
the existing Windows credential inside a short-lived host-only Python worker.
The worker returns bounded HTTP data through anonymous pipes and never returns
the key. It uses the production keyring target/UTF-16 encoding, without changing
the credential store. Catalogue-only preflight succeeds for `gpt-6.1-terra`.

Decisions compared with synthetic-only transport:

- Fix provider origin, model, low effort and Chat protocol on the host. Accept
  only declared Chat fields, capped output and supplied inline images; no
  arbitrary URLs, redirects, headers, remote-image fetches or protocol fallback.
- Retain host-side request identities and persist an unknown-cost reservation
  before network dispatch. Duplicate IDs, missing catalogue preflight, concurrent
  requests, exhausted request/token-estimate budgets and deadlines stop dispatch.
- Keep usage/cache/reasoning objects raw. Cache/reasoning subsets are not added
  as extra billed tokens. Interrupted/failed/unknown usage remains recorded and
  closes the relay; publication failure never repeats an already billed call.
- Keep credentials out of guest mappings, argv, environment and result JSON.
  Disable Python site customization for this standard-library-only worker.
- Buffer responses for the existing bounded file protocol. This is recorded as
  `buffered_response_v1`; provider duration is available, while original per-token
  streaming timing is not reproduced. It is not a browser-speed improvement.

Eight new controls include actual dummy-provider HTTP, redirects, oversized
responses, credential echoes, cancellation, unknown usage, file-publication and
ledger-write failures. Final focused validation passed **104 JavaScript + 70
grader checks**, receipt `ef1782fc-64d2-4fa9-a4d7-58881a5b303e.json`; together with
the preceding full run this gives **450 distinct checks**. A restricted run hit
Windows temporary-path EPERM; the approved unrestricted rerun passed.
The [reviewed relay record](benchmarks/provider-relay-20261106.json) records the
catalogue and validation hashes. Actual hosted inference is still **zero**.
No production app code changed and core paid dispatch remains gated.

## Mission-fixture file transport

Implemented after `eda1aa8`. Browser fixture state and controller checkpoints
remain host-owned. The network-disabled guest receives only framed requests and
responses; no fixture-state or correction/reset API is exposed to it.

Decisions compared with the one-route synthetic smoke:

- Select an exact B01/B02/B03/M02 HTTP route contract on the host, including
  ordinary fixture JSON, intended mutations and the real orders CSV attachment.
  Keep the old smoke's one-route validator and smaller limits as its default.
- Permit up to 4,096 shared fixture/provider messages and 64 MiB aggregate
  transport bytes for this explicit contract, while retaining 1 MiB decoded
  bodies. Provider calls keep their separate request/output/token-estimate caps;
  a high shared message ID does not create an extra paid-call allowance.
- Preserve `Content-Disposition` only for the declared `orders.csv` attachment;
  no arbitrary headers, remote URLs, path normalization or redirects are exposed.
- Persist mutation intent and completed response/state hashes before publication.
  Repeated IDs or a failed publication cannot append the same committed note
  again. Missing state after an interruption remains an error, not a reset.
- Keep fixture HTTP activity separate from evidence of browser interaction. The
  host ledger explicitly says `unobserved` until an independent browser reader
  supplies that evidence; sending the right HTTP request alone cannot earn it.
- Retain regression stdout/stderr and hashes as well as exit statuses. One
  aggregate unit stage failed without retained diagnostics; subsequent focused
  and full unit checks passed unchanged. ZA-014 tracks the undiagnosed failure.

Four real headless-browser controls pass through the framed exchange: ticket
edit, filtered CSV download with the exact retained hash/filename, later draft
correction/submission, and recovery-ticket note/status changes. Other controls
reject undeclared routes, changed ledgers/responses, duplicate mutation effects
and ledger-write failures. The first M02 test used the wrong accessible label;
the test was corrected to the existing `Ticket status` field.

Fresh guest `b2101630-bec9-46f4-aff5-e643f0cdef2a` passed all nine runtime and
host-transport checks: the real Zeus app/Python/managed Chromium, two synthetic
provider requests and three host fixture requests, immutable exchange/fixture
hashes, fresh storage, disabled network and zero remaining owned processes.
This guest smoke navigates the orders fixture; the complete CSV interaction is
covered by the separate real-browser control. Neither is a model capability run.

Final full regression passed **458 checks**: 112 JavaScript, 70 graders, 126 Rust,
23 browser-service, 124 desktop and 3 private-desktop handoff checks. Receipt
`f6bc95bd-897e-4b70-b689-04745614867b.json` retains untruncated hashed stdout/stderr
for every stage. The earlier failed aggregate receipt remains failed; the cause
has not been established. The
[reviewed fixture record](benchmarks/mission-fixture-transport-20261106.json)
retains source, lifecycle, host transport/fixture and validation hashes.
Hosted inference remains **zero**; no production app source changed. Independent
HCS disposal/CPU/disk quotas, isolated actor integration and the full core live
baseline remain incomplete.

## Protected actor and bounded artifact export — 7 November

The user confirmed that the twelve scenarios remain the agreed scope and
authorized continuation. The delivery packet now separates 12/12 implemented
contracts/graders/native scripted workflows from isolated live-run integration
and the uncollected 72-attempt Solo/Team baseline. Agent failures are valid
measurements; full benchmark delivery does not require tuning to 100% success.

Decisions compared with the elevated guest runtime smoke:

- Run the real app, its Python actions and managed browser under the disposable
  non-admin account. Keep the collector/signing key and intermediate runtime
  report private to the controller. Actual startup identity, private-file/process
  access, runtime permissions and final account cleanup must all be observed.
- Resolve the new user's profile folders from its actual Windows token rather
  than inheriting the controller's profile environment strings. No host account,
  credential, policy, desktop-input or production app change is made.
- Stop candidate processes before collecting declared artifacts. Transfer bounded
  bytes only: at most 64 files, 2 MiB each, 8 MiB encoded packet. Preserve missing
  files, reject links/device paths/changed bytes and bind the export hash to the
  host-pinned signed result. The host retains data without executing submissions.
- Prepare public input/config packets for all twelve missions, including D02's
  initial database. Compare original starter bytes exactly; do not stage grader
  code or reference solutions. Solo/Team roles keep the existing frozen binding.
- Replace the intermittently blank redirected-process `ExitCode` property with
  a retained native process-handle wait/status read. Verify running status and
  actual exits 0, 37 and 259. The native wait distinguishes a terminated process
  returning 259 from one still running; see Microsoft's
  [wait](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)
  and [exit-code](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)
  contracts.

The initial protected-startup guest `daefb44a-5f9c-4b7b-aa30-4da62373b0a9`
passed its earlier startup-only contract. The stronger final guest
`59465432-312b-430c-93bb-d076dfbe2ffc` passed all ten runtime/boundary/export checks:
the real app wrote a file as the standard user, completed its managed browser
action, closed owned processes, disabled the account, and exported input/output
bytes with the exact unique challenge hash. The host verified the signed export
and retained both files in a fresh owned directory. The initial control is not
retroactively counted as passing the stronger export check.

Final focused validation passed **117 JavaScript + 70 grader checks**, receipt
`d0e2f062-102c-4d66-9086-4244510d5be5.json`. Combined distinct coverage with the
preceding complete run is **463 checks**, plus the fresh guest controls. No
production app source changed. The native-exit failure and two test-authoring
failures remain in their original receipts: the disabled-role assertion expected
the wrong sentinel, and a legitimate public `reference_note` was initially
mistaken for a reference solution. Tests now compare the actual public bytes.
A separate fixture control read its log before a page reload finished; it now
waits for remaining network work on that controlled page before inspection.
No production browser delay was added. ZA-014 retains the earlier undiagnosed
failure and the subsequently observed native-exit defect.

The [reviewed actor/export record](benchmarks/protected-actor-export-20261107.json)
binds the export, public packets, source, validation and lifecycle hashes.
Hosted inference in this slice: **zero**. These are scripted runtime/export
controls, not twelve new model outcomes or a full isolation certificate.

## Next work

No further host restart is required. Notify the user before subsequent guest
windows. Prepare a fresh current-code session rather than launching old copies.
Connect the host provider relay, mission-fixture transport and public mission
packets to complete isolated actor workflows, including compaction and
confirmed-checkpoint restart. Use the verified bounded export for independent
grading. Keep actual mission time limits distinct from the short synthetic probe.
Preserve the current synthetic transport as a
no-inference prerequisite check. Complete remaining OS lifecycle/resource controls.
Then freeze/review a live
pilot manifest and use its resource evidence for the repeated full Solo/Team run.
Keep ZA-012 context/protocol efficiency observations alongside those measurements.
The full twelve-mission baseline is not complete merely because its graders pass.

## Combined single-turn isolated mission runner — 7 November

The user authorized the next integration slice. A new explicit developer runner
prepares public task/config/input packets and controller-private scripted replies,
then runs the real production app under the standard guest account. It connects
the existing host relay, signed artifact/trace collection and independent graders.
Its supported single-turn scope is C01/C02/C03/D01/D02/R01/V01.

Decisions compared with disconnected runtime/export probes:

- Exercise frozen model settings through the normal provider gateway and
  permission machinery, using a disposable dummy guest credential and host fake
  provider. Remove offline/eval auto-allow switches. This verifies the eventual
  request shape without hosted calls; the live driver remains gated.
- Share the existing bridge approval/cancellation loop with native mission
  diagnostics. Read back task settings/limits, retain all persisted messages and
  the current bounded debug snapshot, then stop the candidate account before
  signing declared file/trace hashes. Original inputs remain part of the export.
- Reconcile app usage, host provider ledger and immutable framed request/response
  bytes. Label synthetic usage explicitly. Correct execution and correct output
  remain separate: a deliberately wrong submission must produce a failed outcome.
- Grade C01/C02/C03/D02 exports in a second fresh guest after the actor guest
  closes. Even a known calibration program does not receive host-execution
  permission through this runner. Other graders read exported files as data.
- Keep short probes capped at 180 seconds. Only a declared mission calibration
  receives a separate 780-second controller ceiling around its 600-second task
  limit. Preserve existing transport/export byte bounds and owned-process cleanup.
- An explicit list runs sequentially, saves each result and stops on an
  infrastructure error. There is no automatic retry, tuning loop or model sweep.

All **seven positive controls passed**: C01/C02/C03/D01/D02/R01/V01. The
deliberately wrong D01 submission finished execution and correctly failed the
independent outcome checks. This used eight actor guests and four separate
executable-grading guests, with owned host processes closed after each. All
sixteen synthetic provider requests matched the app usage and host ledgers.
V01's outgoing request includes both original image byte hashes. The
[reviewed calibration record](benchmarks/isolated-single-turn-calibration-20261107.json)
retains result, lifecycle, artifact, trace, source and provider-ledger identities.

Final validation passed **122 JavaScript + 70 grader checks**, receipt
`4c2cdb6a-c237-45f2-b688-30a1e07bad7d.json`. Earlier focused receipt
`ae04472a-95ea-46ee-b274-b95c041ad5c7.json` passed 121 + 70 before the additional
Windows controller guard check. That check proves extended ordinary probes and
an undeclared hosted mode are rejected before a window is launched. Together
with the preceding full regression run, distinct coverage is 468 checks.
Hosted inference in this slice: **zero**. No production agent/UI/Rust source changed.

The remaining isolated browser/multi-turn workflows are B01/B02/B03/M01/M02,
including actual downloads, later corrections, compaction and committed-checkpoint
restart. Complete full hosted transport/policy/lifecycle/resource validation,
then freeze a pilot and review its measurements before the repeated 72-attempt
Solo/Team schedule. Scripted controls do not demonstrate model intelligence,
genuine Team collaboration or complete authorization coverage. Independent HCS
disposal and CPU/writable-mapping disk hard quotas remain unvalidated.

## Browser and multi-turn isolated integration — 7 November

All twelve authored scenarios now have passing scripted controls through the
isolated runner. B01/B02/B03/M01/M02 complete the five remaining workflows. These
are software calibrations; no live model was called and no intelligence or active
Team collaboration result is claimed. The
[reviewed workflow record](benchmarks/isolated-workflows-20261107.json) binds
the positive/negative pairs, staged source, host ledgers, signed exports and VM
lifecycle receipts. It links the earlier seven-scenario record without recasting
these development checkpoints as one frozen study.

Decisions compared with the preceding single-turn runner:

- Keep fixture state and grading in the host broker. Forward only the declared
  local fixture routes; translate only the fixed guest proxy origin for browser
  evidence. Use production ownership-checked observation/action/transfer readers,
  not the actor's chat or submitted JSON, to establish browser interaction and
  downloaded-byte provenance.
- Authenticate correction and restart checkpoints with the controller's
  host-pinned signing key and job/nonce/packet binding. Ordinary web requests,
  forged signatures and repeated phases cannot create these checkpoints.
- Reuse the existing scenario contracts and budget calculation. M01 injects
  bounded untrusted reference noise, then checks actual compaction receipts and
  original-message hashes. M02 verifies the old app's exit, restarts the same
  workspace and carries reduced requests/tokens/directives/time forward after
  the host confirms the saved note. This is a confirmed-commit restart test;
  arbitrary mid-command crashes and lost acknowledgments remain outside it.
- Approve only exact declared calibration scripts through normal permission
  handling. Canonical action digests include language/code/timeout and do not
  depend on JSON property order. This is not a new live-model permission policy.
- Keep diagnostic exports after collector errors only when final account/process
  cleanup is verified. Bound complete trace encoding before assigning exportable
  state, so oversized failed-run diagnostics cannot escape the trace limit.

The new negative controls all finished executing their intended operations, then
failed the intended independent criterion: wrong ticket priority, wrong order
summary despite a real CSV download, wrong revised draft owner, stale project
requirements despite actual compaction, and wrong final status after a genuine
restart. Their required browser/compaction/restart evidence still passed. No
automatic retry/tuning loop or agent-specific solver was introduced.

Two original development failures remain retained. B01 session
`4f228aa3-41da-4c01-86d4-cd58d550ecbd` performed its actual update, but the new
collector mistook a signaled child with null `exitCode` for a running launcher.
Track the real close event and separately verify the actual app process identity
has exited; a real terminated-child regression now covers this. The failed row
remains an infrastructure error, not a passing result. A fresh B01 and the D01
shared-cleanup recheck passed after the repair.

B02 session `a1c233db-2d05-4d84-a74f-08c7cb372cea` hit a generic audio-policy
startup error before navigation and correctly failed for a missing CSV. A fresh
unchanged-source B02 passed. A separate controlled browser regression reproduced
an audio setup failure when a tab closes between enumeration and mute setup;
the definitive pre-repair log is `.zeus/evaluations/audio-race-before-fix.log`.
The regression's initial cleanup callback returned a native function and masked
the error; it was corrected before retaining that definitive reproduction.
Ignore only the native missing-tab response, preserve global sound blocking and
the existing deadline, and keep all other policy errors blocking with bounded
diagnostics. The original generic failure cannot uniquely establish its cause.
ZA-015 retains that distinction. No broad retry or reduced verification was added.

The rebuilt bundle `08d4f508-0118-4911-be10-6478abc5ea5a`, content hash
`b1468f4d32e7420ffd286703b04f49fb69f199b38996df75b0c916889759f860`, retains the
same pinned dependency versions. All four browser positives and all five new
negative controls were checked with it. M01's positive control is the separately
retained pre-audio-repair runtime checkpoint; it uses no browser. The original
runtime bundle and all failed attempts remain unchanged.

Full regression receipt `08abdb2e-d563-4ff4-a0fb-842b387e2613.json` passed **476
checks**: 128 JS, 70 graders, 126 Rust, 25 browser-service, 124 desktop and three
private native handoff checks. The final focused receipt
`8463aaba-3c6f-4470-bc20-b0af2cf44762.json` passed **129 JS checks**, adding the
failed-trace export boundary check after that full run; distinct coverage is 477.
The evaluation binary build and two focused audio regressions also passed.
Hosted inference in this slice: **zero**.

Next: connect the full hosted provider path with its response deadlines and
failure-inclusive accounting, resolve/declare the remaining execution policy and
resource/lifecycle acceptance gates, freeze a clean pilot manifest and check the
current catalogue before dispatch. Use pilot evidence to review the repeated
72-attempt envelope. The core `--live` entry point remains gated. Do not equate
12/12 scripted workflow calibration with a collected Solo/Team live baseline.
