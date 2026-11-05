# Explicit OS prerequisite for the benchmark. Default is plan-only.
# No automatic elevation, reboot, policy change, account or firewall mutation.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([switch]$Enable)

$ErrorActionPreference = 'Stop'
$featureName = 'Containers-DisposableClientVM'
$repoDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if (-not (Test-Path -LiteralPath (Join-Path $repoDirectory 'src-tauri\Cargo.toml'))) {
    throw 'Run this script from its Zeus repository location.'
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$sandboxFile = Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe'
$record = [ordered]@{
    schema_version = 1
    mode = $(if ($Enable) { 'enable' } else { 'plan' })
    feature = $featureName
    edition = $os.EditionID
    build = $os.CurrentBuild
    administrator = $isAdmin
    executable_exists = (Test-Path -LiteralPath $sandboxFile)
    status = 'plan'
    changed = $false
    change_attempted = $false
    restart_needed = $null
    automatic_restart = $false
    command = 'Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All -NoRestart'
    note = 'Enabling the component does not validate the benchmark execution boundary.'
}
$exitStatus = 0
if ($Enable) {
    if (-not $isAdmin) { throw 'Administrator elevation is required. No machine feature was changed.' }
    if ($os.EditionID -notmatch '^(Professional|Enterprise|Education)') { throw 'This script requires a supported Windows Pro, Enterprise or Education edition.' }
    try {
        $before = Get-WindowsOptionalFeature -Online -FeatureName $featureName
        $record['before_state'] = [string]$before.State
        if ($before.State -eq 'Enabled') {
            $record.status = 'already_enabled'
        } elseif ($PSCmdlet.ShouldProcess('Windows Sandbox component', 'Enable with dependencies, without restarting')) {
            $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
            $hypervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
            if (-not ($cpu.VirtualizationFirmwareEnabled -or $hypervisor)) { throw 'Firmware virtualization could not be confirmed. No feature was enabled.' }
            $record.change_attempted = $true
            $result = Enable-WindowsOptionalFeature -Online -FeatureName $featureName -All -NoRestart
            $record.changed = $true
            $record.restart_needed = [bool]$result.RestartNeeded
            $record.status = $(if ($result.RestartNeeded) { 'restart_required' } else { 'enabled_needs_validation' })
            if ($result.RestartNeeded) { $exitStatus = 2 }
        } else {
            $record.status = 'not_changed'
        }
    } catch {
        $record.status = 'error'
        if ($record.change_attempted) { $record.changed = $null }
        $record['error'] = $_.Exception.Message
        $exitStatus = 1
    }
}
$record['completed_at'] = [DateTime]::UtcNow.ToString('o')
$directory = Join-Path $repoDirectory '.zeus\evaluations\sandbox-setup'
# Do not follow a redirected project directory while elevated.
$cursor = $directory
while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked receipt directory.' }
    }
    $parent = Split-Path -Parent $cursor
    if ($parent -eq $cursor) { break }
    $cursor = $parent
}
[IO.Directory]::CreateDirectory($directory) | Out-Null
$receipt = Join-Path $directory (([Guid]::NewGuid().ToString()) + '.json')
$json = $record | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($receipt, $json, (New-Object Text.UTF8Encoding($false)))
Write-Output $json
Write-Output ('Receipt: ' + $receipt)
if ($record.restart_needed) { Write-Output 'A Windows restart is required. This script will not restart the PC.' }
exit $exitStatus
