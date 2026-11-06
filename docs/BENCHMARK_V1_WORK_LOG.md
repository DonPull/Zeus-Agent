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

## Next work

No further host restart is required. Notify the user before subsequent guest
windows. Prepare a fresh current-code session rather than launching old copies.
Implement and validate isolated mission orchestration, bounded provider/fixture/artifact
transport, separate executable grader and OS lifecycle/cleanup controls.
Then freeze/review a live
pilot manifest and use its resource evidence for the repeated full Solo/Team run.
Keep ZA-012 context/protocol efficiency observations alongside those measurements.
The full twelve-mission baseline is not complete merely because its graders pass.
