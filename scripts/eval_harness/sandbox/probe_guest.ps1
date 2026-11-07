# Runs only INSIDE the disposable Sandbox. No host launch or reboot operation.
$ErrorActionPreference = 'Stop'
$inputDirectory = 'C:\Zeus\Input'
$outputDirectory = 'C:\Zeus\Output'
$job = Get-Content -LiteralPath (Join-Path $inputDirectory 'job.json') -Raw | ConvertFrom-Json
if ($job.schema_version -ne 2 -or $env:USERNAME -ne 'WDAGUtilityAccount' -or $env:COMPUTERNAME -eq $job.host_name) { throw 'This probe must execute only in the prepared disposable guest.' }
$marker='C:\Zeus\guest-only-marker.txt'
$markerPreexisting=Test-Path -LiteralPath $marker
[IO.File]::WriteAllText($marker, $job.id)
$result = [ordered]@{
    schema_version = 2
    id = $job.id
    nonce = $job.nonce
    computer = $env:COMPUTERNAME
    started_at = [DateTime]::UtcNow.ToString('o')
    challenge_sha256 = (Get-FileHash -LiteralPath (Join-Path $inputDirectory 'challenge.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    input_write_denied = $false
    private_read_denied = $false
    active_nonloopback_adapters = $null
    output_written = $true
    marker_preexisting = $markerPreexisting
    marker_created = (Test-Path -LiteralPath $marker)
}
try {
    # If a misconfigured mapping permits this, the host hash check will also fail.
    [IO.File]::AppendAllText((Join-Path $inputDirectory 'challenge.txt'), 'Unexpected guest write')
} catch { $result.input_write_denied = $true }
try {
    $unmappedBytes = [IO.File]::ReadAllBytes($job.private_host_path)
    $result.private_read_denied = $false
} catch { $result.private_read_denied = $true }
$adapters = @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object {
    $_.OperationalStatus -eq [Net.NetworkInformation.OperationalStatus]::Up -and
    $_.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Loopback -and
    $_.NetworkInterfaceType -ne [Net.NetworkInformation.NetworkInterfaceType]::Tunnel
})
$result.active_nonloopback_adapters = $adapters.Count
$webviewRoots=@('C:\Program Files (x86)\Microsoft\EdgeWebView\Application','C:\Program Files\Microsoft\EdgeWebView\Application')
$webviewVersions=@(foreach ($root in $webviewRoots) {
    if (Test-Path -LiteralPath $root) {
        Get-ChildItem -LiteralPath $root -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe') } | Select-Object -ExpandProperty Name
    }
})
$result['runtime_inventory']=[ordered]@{
    windows_build=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuild
    powershell=$PSVersionTable.PSVersion.ToString()
    webview2_versions=$webviewVersions
    node_available=[bool](Get-Command node.exe -ErrorAction SilentlyContinue)
    python_available=[bool](Get-Command python.exe -ErrorAction SilentlyContinue)
}
if ($job.runtime_smoke) {
    try {
        $manifestFile='C:\Zeus\RuntimeInput\bundle.json'
        if ((Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.runtime_smoke.manifest_sha256) { throw 'Runtime manifest hash changed.' }
        $bundle=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
        if ($bundle.kind -ne 'public-sandbox-runtime-bundle' -or $bundle.files.Count -gt 20000 -or $bundle.bytes -gt 2147483648) { throw 'Invalid runtime bundle bounds.' }
        Copy-Item -LiteralPath 'C:\Zeus\RuntimeInput\runtime' -Destination 'C:\Zeus\Runtime' -Recurse
        foreach ($file in $bundle.files) {
            if ($file.path -match '(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)') { throw 'Invalid relative runtime path.' }
            $localFile=Join-Path 'C:\Zeus\Runtime' $file.path
            if ((Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Copied runtime hash mismatch: '+$file.path) }
        }
        # Sandbox's default user is elevated. WebView2 >=150 intentionally
        # ignores environment/HKCU debugging switches in that context. Configure
        # only this guest's test executable through the documented HKLM policy.
        $debugPolicy='HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
        New-Item -Path $debugPolicy -Force | Out-Null
        New-ItemProperty -LiteralPath $debugPolicy -Name 'zeus-evaluation.exe' -PropertyType String -Value '--remote-debugging-port=19223 --disable-background-timer-throttling --disable-renderer-backgrounding' -Force | Out-Null
        $result['runtime_control_transport']='guest-only per-application WebView2 policy'
        $controlScript='C:\Zeus\Input\guest_smoke.mjs'
        if ($job.runtime_smoke.mode -eq 'grader-controls-v1') { $controlScript='C:\Zeus\Input\guest_grading.mjs' }
        if ($job.runtime_smoke.mode -eq 'candidate-boundary-v1') { $controlScript='C:\Zeus\Input\guest_candidate_probe.mjs' }
        if ($job.runtime_smoke.mode -eq 'submission-grade-v1') { $controlScript='C:\Zeus\Input\guest_submission.mjs' }
        if ($job.runtime_smoke.mode -eq 'protected-actor-v1') { $controlScript='C:\Zeus\Input\guest_actor_probe.mjs' }
        if ($job.runtime_smoke.mode -eq 'mission-job-v1') { $controlScript='C:\Zeus\Input\guest_mission.mjs' }
        $env:ZEUS_GUEST_BASE_RESULT=($result | ConvertTo-Json -Depth 6 -Compress)
        $controlProcess=Start-Process -FilePath 'C:\Zeus\Runtime\node\node.exe' -ArgumentList $controlScript -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput 'C:\Zeus\runtime-console.txt' -RedirectStandardError 'C:\Zeus\runtime-errors.txt'
        $result['runtime_smoke']=Get-Content -LiteralPath 'C:\Zeus\runtime-report.json' -Raw | ConvertFrom-Json
    } catch {
        $result['runtime_smoke']=[ordered]@{status='failed'; error=$_.Exception.Message}
    }
}
$result['completed_at'] = [DateTime]::UtcNow.ToString('o')
$temporary = Join-Path $outputDirectory 'probe-result.tmp'
$destination = Join-Path $outputDirectory 'probe-result.json'
[IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
[IO.File]::Move($temporary, $destination)
# Intentionally stay open for external inspection. Closing Sandbox discards the
# guest. Do not infer VM termination from the existence of the result file.
