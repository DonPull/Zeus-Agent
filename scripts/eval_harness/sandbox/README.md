# Benchmark execution environment

Status, 6 November: component enable succeeded; a manual Windows restart is
required. No reboot was triggered. This is not a validated isolated executor.

The current host is Windows 11 Pro 23H2 with firmware virtualization and SLAT,
and the Windows Sandbox component was initially absent. The reviewed prerequisite is
the included PowerShell script. Its default prints a plan and writes a project
receipt without changing Windows. The explicit `-Enable` mode requires an
administrator and calls only the named optional-feature operation with
`-All -NoRestart`. It does not elevate itself, reboot, change policies, create
accounts or add firewall rules. Exit 2 means the operation needs a manual restart.

After user approval, an administrator can run:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/eval_harness/sandbox/enable_windows_sandbox.ps1 -Enable
```

[Microsoft's installation instructions](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-install)
document the administrator operation and possible restart. The newer 24H2 CLI is
not required. Do not automatically disable existing virtualization dependencies
as cleanup: they may serve other software.

Enabling the OS feature is not proof that the benchmark is isolated. Remaining
work includes the runtime bundle, restricted mappings/egress, actor/export and
separate executable-grader protocols, failure controls and actual guest probes.
No actor-created executable may run on the host while those gates are incomplete.
