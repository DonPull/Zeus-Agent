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

## Next work

No further host restart is required. Notify the user before subsequent guest
windows. Prepare a fresh current-code session rather than launching old copies.
Implement the live provider broker with host-only credentials/
caps, all-mission fixture/artifact transport and isolated mission orchestration.
Preserve the current synthetic transport as a
no-inference prerequisite check. Complete remaining OS lifecycle/resource controls.
Then freeze/review a live
pilot manifest and use its resource evidence for the repeated full Solo/Team run.
Keep ZA-012 context/protocol efficiency observations alongside those measurements.
The full twelve-mission baseline is not complete merely because its graders pass.
