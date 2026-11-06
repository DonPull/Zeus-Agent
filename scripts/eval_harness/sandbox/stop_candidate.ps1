# Guest-only teardown by token SID, including children started through services.
$ErrorActionPreference='Stop'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')[-1] -ne 'WDAGUtilityAccount' -or -not (Test-Path -LiteralPath 'C:\Zeus\GraderPrivate\candidate.json')) { throw 'Disposable guest controller identity required.' }
$job=Get-Content -LiteralPath 'C:\Zeus\Input\job.json' -Raw | ConvertFrom-Json
if ([Environment]::MachineName -eq $job.host_name) { throw 'Host execution is forbidden.' }
$account=Get-Content -LiteralPath 'C:\Zeus\GraderPrivate\candidate.json' -Raw | ConvertFrom-Json
Disable-LocalUser -Name $account.username
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
public class ZeusGuestTokenOwner {
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr buffer,int size,out int needed);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static string Sid(IntPtr process) {
        IntPtr token;if(!OpenProcessToken(process,8,out token))return null;
        try {int needed;GetTokenInformation(token,1,IntPtr.Zero,0,out needed);if(needed<1||needed>65536)return null;
            IntPtr data=Marshal.AllocHGlobal(needed);
            try {if(!GetTokenInformation(token,1,data,needed,out needed))return null;return new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value;}
            finally {Marshal.FreeHGlobal(data);}
        } finally {CloseHandle(token);}
    }
}
'@
$killed=New-Object 'Collections.Generic.List[int]'
function Owned-Processes {
    foreach ($process in Get-Process) {
        try {
            if ([ZeusGuestTokenOwner]::Sid($process.Handle) -eq $account.sid) { $process;continue }
        } catch { } # Protected system tokens are unrelated to the candidate.
        $process.Dispose()
    }
}
for ($pass=0;$pass -lt 3;$pass++) {
    $owned=@(Owned-Processes)
    if (-not $owned.Count) { break }
    foreach ($process in $owned) {
        try { $killed.Add($process.Id);$process.Kill();[void]$process.WaitForExit(2000) }
        finally { $process.Dispose() }
    }
}
$remaining=@(Owned-Processes)
foreach($process in $remaining) { $process.Dispose() }
[ordered]@{candidate_sid=$account.sid;killed=$killed.ToArray();remaining=$remaining.Count;account_disabled=$true} | ConvertTo-Json -Compress
if($remaining.Count) { exit 1 }
