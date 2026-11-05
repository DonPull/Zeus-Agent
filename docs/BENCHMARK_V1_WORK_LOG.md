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

Read-only checks found Windows 11 Pro 23H2 with firmware virtualization and SLAT,
but no enabled Sandbox/VM runtime. No machine feature, privilege, account, network
rule or restart was changed. The .wsb-based setup and isolated actor/grader
transport still need implementation and validation; the newer 24H2 Sandbox CLI
cannot be assumed on this host.

## Next work

The user confirmed availability for the administrator/UAC setup on 6 November.
The reviewed `scripts/eval_harness/sandbox/enable_windows_sandbox.ps1` defaults
to plan-only; its explicit enable mode uses `-NoRestart`. The first plan receipt
is `sandbox-setup/98647486-be6e-44cc-a6d2-6edcde9450bb.json` under evaluations.
The component enable step succeeded with status **restart_required**, exit 2,
administrator true, before state Disabled, changed true and automatic restart
false. Windows must be restarted manually before guest validation. Inspect the
newest `sandbox-setup` receipt after any interruption. No automatic reboot is
allowed. Runtime-workflow hooks are
being added to `mission_runtime.js` / `trial_runner.js` but are not validated yet;
the pushed validated 2D1 checkpoint is `70af36e`.

Wire new contracts through the production bridge with actual later messages,
downloads, compaction receipts and app restart. Prepare and validate bounded
artifact transfer and the isolated executable grader. Then freeze/review a live
pilot manifest and use its resource evidence for the repeated full Solo/Team run.
Keep ZA-012 context/protocol efficiency observations alongside those measurements.
The full twelve-mission baseline is not complete merely because its graders pass.
