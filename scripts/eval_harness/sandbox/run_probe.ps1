# Explicit, synthetic guest probe. No hosted inference, OS setup or host reboot.
# Run mode launches a window; use only after notifying the user.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('Run','Cleanup')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$SessionDirectory,
    [ValidateRange(15,180)][int]$TimeoutSeconds=90
)
$ErrorActionPreference='Stop'
$repoDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$sessionsRoot=[IO.Path]::GetFullPath((Join-Path $repoDirectory '.zeus\evaluations\sandbox-sessions'))
$sessionRoot=[IO.Path]::GetFullPath($SessionDirectory).TrimEnd('\')
if ((Split-Path -Parent $sessionRoot) -ne $sessionsRoot -or (Split-Path -Leaf $sessionRoot) -notmatch '^[0-9a-f-]{36}$') { throw 'Use one prepared session directly below the owned sandbox-sessions directory.' }
for ($cursor=$sessionRoot; $cursor; $cursor=Split-Path -Parent $cursor) {
    $item=Get-Item -LiteralPath $cursor -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a linked or redirected session directory.' }
    if ((Split-Path -Parent $cursor) -eq $cursor) { break }
}
$configuration=Join-Path $sessionRoot 'probe.wsb'
$launchFile=Join-Path $sessionRoot 'host-launch.json'
$clientFile=Join-Path $sessionRoot 'host-client.json'
$transportFile=Join-Path $sessionRoot 'host-transport.json'
$lifecycleFile=Join-Path $sessionRoot ('host-lifecycle-'+[Guid]::NewGuid().ToString()+'.json')
$node=(Get-Command node.exe -ErrorAction Stop).Source
$probeScript=Join-Path $PSScriptRoot 'probe.js'
$manifest=Get-Content -LiteralPath (Join-Path $sessionRoot 'session.json') -Raw | ConvertFrom-Json
if ($manifest.kind -ne 'sandbox-boundary-probe' -or $manifest.id -ne (Split-Path -Leaf $sessionRoot)) { throw 'Prepared probe identity mismatch.' }
if ($Mode -eq 'Run' -and $manifest.schema_version -ne 2) { throw 'Prepare a new protocol-2 probe.' }
if ((Get-FileHash -LiteralPath $configuration -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.configuration_sha256) { throw 'Prepared configuration changed.' }

function Save-Json([string]$Path,$Value) {
    $temporary=$Path+'.tmp'
    [IO.File]::WriteAllText($temporary,($Value | ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary,$Path,$null) }
    else { [IO.File]::Move($temporary,$Path) }
}
function Process-Proof($Process,[int]$Parent=0) {
    # .StartTime opens a process handle. Keep that object alive through teardown,
    # and compare exact creation time on that handle before calling Kill().
    return [ordered]@{pid=$Process.Id; started_utc=$Process.StartTime.ToUniversalTime().ToString('o'); parent_pid=$Parent; name=$Process.ProcessName}
}
function Owned-Process($Proof,[string]$Name) {
    $process=Get-Process -Id $Proof.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    if ($process.ProcessName -ne $Name -or $process.StartTime.ToUniversalTime().ToString('o') -ne $Proof.started_utc) { $process.Dispose(); throw 'Process identity changed; refusing to terminate a possibly reused PID.' }
    return $process
}

$launcher=$null
$launchProof=$null
$clientProof=$null
$broker=$null
$brokerProof=$null
$record=[ordered]@{schema_version=1; probe_id=$manifest.id; mode=$Mode; started_at=[DateTime]::UtcNow.ToString('o'); status='running'; inspection=$null; cleanup=$null; provider_requests=0; physical_input=$false; isolation_validated=$false}
$record['controller_sha256']=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$exitStatus=1
$slot=New-Object Threading.Mutex($false,'Local\ZeusBenchmarkSandboxV1')
$ownsSlot=$false
try { $ownsSlot=$slot.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $ownsSlot=$true }
if (-not $ownsSlot) { $slot.Dispose(); throw 'Another Zeus Sandbox controller holds the host slot.' }
try {
    if ($Mode -eq 'Run') {
        if ((Test-Path -LiteralPath $launchFile) -or (Get-Process -Name WindowsSandbox,WindowsSandboxClient -ErrorAction SilentlyContinue)) { throw 'The session was already launched or a foreign Sandbox is open.' }
        if (@(Get-ChildItem -LiteralPath (Join-Path $sessionRoot 'output') -Force).Count) { throw 'Probe output must be empty before launch.' }
        if ($manifest.transport_smoke -or $manifest.grading_auth) {
            if ($manifest.transport_smoke -and $manifest.transport_smoke -ne 'synthetic-file-v1') { throw 'Unknown transport mode; hosted inference is not available.' }
            $brokerName=if ($manifest.grading_auth) { 'host_grading_auth.mjs' } else { 'host_transport.mjs' }
            $brokerScript=Join-Path $PSScriptRoot $brokerName
            $record['transport_code_sha256']=[ordered]@{}
            foreach ($source in @($brokerName,'file_rpc.mjs','session.js','grading_auth.mjs','mission_rpc.mjs','mission_fixture.mjs')) { $record.transport_code_sha256[$source]=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $source) -Algorithm SHA256).Hash.ToLowerInvariant() }
            $broker=Start-Process -FilePath $node -ArgumentList @(('"'+$brokerScript+'"'),('"'+$sessionRoot+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $sessionRoot 'transport-stdout.log') -RedirectStandardError (Join-Path $sessionRoot 'transport-stderr.log')
            # Retain the native handle before the redirected child can exit.
            $null=$broker.Handle
            $brokerProof=Process-Proof $broker
            Save-Json $transportFile $brokerProof
        }
        $launcher=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe') -ArgumentList ('"'+$configuration+'"') -WindowStyle Hidden -PassThru
        $launchProof=Process-Proof $launcher
        $launchProof['kind']='external-sandbox-launch'
        $launchProof['configuration_sha256']=$manifest.configuration_sha256
        Save-Json $launchFile $launchProof
        $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while ([DateTime]::UtcNow -lt $deadline) {
            if (-not $clientProof) {
                $children=@(Get-CimInstance Win32_Process -Filter ("ParentProcessId="+$launcher.Id) | Where-Object { $_.Name -eq 'WindowsSandboxClient.exe' })
                if ($children.Count -gt 1) { throw 'Ambiguous Sandbox child ownership.' }
                if ($children.Count -eq 1) {
                    $client=Get-Process -Id $children[0].ProcessId -ErrorAction Stop
                    try { $clientProof=Process-Proof $client $launcher.Id }
                    finally { $client.Dispose() }
                    # Never persist or print the raw command line: it contains an
                    # ephemeral guest account password on this Windows version.
                    $match=[regex]::Match($children[0].CommandLine,'<ContainerId>([0-9a-f-]{36})</ContainerId>')
                    if ($match.Success) { $clientProof['container_id']=$match.Groups[1].Value }
                    Save-Json $clientFile $clientProof
                }
            }
            if ((Test-Path -LiteralPath (Join-Path $sessionRoot 'output\probe-result.json')) -and $clientProof) { break }
            if ($launcher.HasExited) { throw 'Sandbox launcher exited before guest evidence and ownership were available.' }
            if ($broker -and $broker.HasExited -and $broker.ExitCode -ne 0) { throw 'Synthetic transport failed; see its retained private receipt or stderr.' }
            Start-Sleep -Milliseconds 200
        }
        if (-not $clientProof -or -not (Test-Path -LiteralPath (Join-Path $sessionRoot 'output\probe-result.json'))) { throw 'Guest probe deadline expired.' }
        if ($broker) {
            $brokerWaited=$broker.WaitForExit(5000)
            $broker.Refresh()
            $record['transport_exit']=[ordered]@{waited=$brokerWaited;exit_code=$broker.ExitCode}
            if (-not $brokerWaited -or $broker.ExitCode -ne 0) { throw 'Synthetic host transport did not complete successfully; see transport_exit and its private receipt.' }
        }
        $inspectionText=& $node $probeScript --inspect-summary $sessionRoot
        $inspectionExit=$LASTEXITCODE
        $inspection=$inspectionText | ConvertFrom-Json
        Save-Json (Join-Path $sessionRoot 'host-inspection.json') $inspection
        $record.inspection=[ordered]@{status=$inspection.status; checks=$inspection.checks; result_sha256=$inspection.result_sha256}
        if ($inspectionExit -ne 2 -or $inspection.status -ne 'probe_claims_consistent') { throw 'Independent probe inspection did not accept the guest observations.' }
        $record.status='probe_observed'
        $exitStatus=0
    } else {
        $launchProof=Get-Content -LiteralPath $launchFile -Raw | ConvertFrom-Json
        # Accept the first manually launched control's recorded field name.
        if (-not $launchProof.started_utc) {
            $launchProof | Add-Member -NotePropertyName started_utc -NotePropertyValue $launchProof.process_started_utc
        }
        if ($launchProof.configuration_sha256 -ne $manifest.configuration_sha256) { throw 'Launch proof belongs to a different configuration.' }
        $launcher=Owned-Process $launchProof 'WindowsSandbox'
        if (Test-Path -LiteralPath $clientFile) {
            $clientProof=Get-Content -LiteralPath $clientFile -Raw | ConvertFrom-Json
        }
        if (Test-Path -LiteralPath $transportFile) {
            $brokerProof=Get-Content -LiteralPath $transportFile -Raw | ConvertFrom-Json
            $broker=Owned-Process $brokerProof 'node'
        }
        $record.status='cleanup_only'
        $exitStatus=0
    }
} catch {
    $record.status='failed'
    $record['error']=$_.Exception.Message
} finally {
    $cleanup=[ordered]@{method='exact-owned-process-handles'; client_terminated=$false; launcher_terminated=$false; client_gone=$null; launcher_gone=$null; transport_gone=$null; compute_system_gone=$null}
    try {
        if ($clientProof) {
            if ($clientProof.parent_pid -ne $launchProof.pid) { throw 'Client proof has a different launcher parent.' }
            $client=Owned-Process $clientProof 'WindowsSandboxClient'
            if ($client) {
                try { $client.Kill(); $cleanup.client_terminated=$true; $cleanup.client_gone=$client.WaitForExit(5000) }
                finally { $client.Dispose() }
            } else { $cleanup.client_gone=$true }
        }
        if ($launchProof) {
            if (-not $launcher) { $launcher=Owned-Process $launchProof 'WindowsSandbox' }
            if ($launcher) {
                if (-not $launcher.WaitForExit(3000)) {
                    if ($launcher.StartTime.ToUniversalTime().ToString('o') -ne $launchProof.started_utc) { throw 'Launcher identity changed during cleanup.' }
                    $launcher.Kill(); $cleanup.launcher_terminated=$true
                }
                $cleanup.launcher_gone=$launcher.WaitForExit(5000)
            } else { $cleanup.launcher_gone=$true }
        }
        if ($launchProof -and ($cleanup.launcher_gone -ne $true -or ($clientProof -and $cleanup.client_gone -ne $true))) { throw 'Owned Sandbox processes did not exit.' }
    } catch {
        $cleanup['error']=$_.Exception.Message
        $record.status='cleanup_failed'
        $exitStatus=1
    }
    try {
        if ($brokerProof) {
            if (-not $broker) { $broker=Owned-Process $brokerProof 'node' }
            if ($broker) {
                if ($broker.StartTime.ToUniversalTime().ToString('o') -ne $brokerProof.started_utc) { throw 'Transport process identity changed.' }
                if (-not $broker.HasExited) { $broker.Kill() }
                $cleanup.transport_gone=$broker.WaitForExit(5000)
            } else { $cleanup.transport_gone=$true }
            if ($cleanup.transport_gone -ne $true) { throw 'Owned transport process did not exit.' }
        }
    } catch { $cleanup['transport_error']=$_.Exception.Message; $record.status='cleanup_failed'; $exitStatus=1 }
    if ($broker) { $broker.Dispose() }
    if ($launcher) { $launcher.Dispose() }
    $record.cleanup=$cleanup
    $record['completed_at']=[DateTime]::UtcNow.ToString('o')
    $record['note']='Observed guest probes and owned host-process exit are partial lifecycle evidence. No independent HCS disposal or full actor/grader certification is claimed.'
    Save-Json $lifecycleFile $record
    if ($ownsSlot) { $slot.ReleaseMutex() }
    $slot.Dispose()
}
$record | ConvertTo-Json -Depth 10
exit $exitStatus
