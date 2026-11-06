# Runs only INSIDE the disposable Sandbox. No host launch or reboot operation.
$ErrorActionPreference = 'Stop'
$inputDirectory = 'C:\Zeus\Input'
$outputDirectory = 'C:\Zeus\Output'
$job = Get-Content -LiteralPath (Join-Path $inputDirectory 'job.json') -Raw | ConvertFrom-Json
$result = [ordered]@{
    schema_version = 1
    id = $job.id
    nonce = $job.nonce
    computer = $env:COMPUTERNAME
    started_at = [DateTime]::UtcNow.ToString('o')
    challenge_sha256 = (Get-FileHash -LiteralPath (Join-Path $inputDirectory 'challenge.txt') -Algorithm SHA256).Hash.ToLowerInvariant()
    input_write_denied = $false
    private_read_denied = $false
    active_nonloopback_adapters = $null
    output_written = $true
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
$result['completed_at'] = [DateTime]::UtcNow.ToString('o')
$temporary = Join-Path $outputDirectory 'probe-result.tmp'
$destination = Join-Path $outputDirectory 'probe-result.json'
[IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
[IO.File]::Move($temporary, $destination)
# Intentionally stay open for external inspection. Closing Sandbox discards the
# guest. Do not infer VM termination from the existence of the result file.
