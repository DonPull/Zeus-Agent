# Guest-only provisioning. Never invoke on the host or map this directory back.
$ErrorActionPreference='Stop'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')[-1] -ne 'WDAGUtilityAccount') { throw 'Disposable guest controller identity required.' }
if (-not (Test-Path -LiteralPath 'C:\Zeus\Input\job.json')) { throw 'Prepared guest job required.' }
$job=Get-Content -LiteralPath 'C:\Zeus\Input\job.json' -Raw | ConvertFrom-Json
if ([Environment]::MachineName -eq $job.host_name) { throw 'Host execution is forbidden.' }
$controllerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
function Set-PrivateDirectory([string]$Directory,$CandidateSid=$null,[string]$CandidateRights='Modify') {
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    $acl=New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($controllerSid);$acl.SetAccessRuleProtection($true,$false)
    foreach($sid in @($controllerSid,$systemSid)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    if ($CandidateSid) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($CandidateSid,$CandidateRights,'ContainerInherit,ObjectInherit','None','Allow'))) }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}
Set-PrivateDirectory 'C:\Zeus\GraderPrivate'
$account='ZeusCandidate'
if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) { throw 'Candidate account must be fresh.' }
$password='Zg9!'+[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$user=New-LocalUser -Name $account -Password (ConvertTo-SecureString $password -AsPlainText -Force) -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword
$usersGroup=Get-LocalGroup -SID 'S-1-5-32-545'
Add-LocalGroupMember -Group $usersGroup -Member $user
Set-PrivateDirectory 'C:\Zeus\CandidateScratch' $user.SID
Set-PrivateDirectory 'C:\Zeus\Grading'
Set-PrivateDirectory 'C:\Zeus\PublicTools' $user.SID 'ReadAndExecute'
Set-PrivateDirectory 'C:\Zeus\Runtime' $user.SID 'ReadAndExecute'
# Copied public dependencies inherited broad guest permissions. Reset only this
# guest-local copied tree, never a mapped host directory or the host itself.
& icacls.exe 'C:\Zeus\Runtime\*' /reset /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the guest-local runtime tree.' }
$record=[ordered]@{username=$account;password=$password;sid=$user.SID.Value}
[IO.File]::WriteAllText('C:\Zeus\GraderPrivate\candidate.json',($record | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText('C:\Zeus\GraderPrivate\canary.txt','private controller data')
Add-Type -TypeDefinition (Get-Content -LiteralPath 'C:\Zeus\Input\candidate_python.cs' -Raw) -OutputAssembly 'C:\Zeus\GraderPrivate\candidate-python.exe' -OutputType ConsoleApplication -ReferencedAssemblies @('System.dll','System.Core.dll','System.Web.Extensions.dll')
