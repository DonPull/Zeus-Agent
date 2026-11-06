# Read a retained process handle directly. Start-Process's adapted ExitCode can
# remain null after redirected children exit, even after WaitForExit/Refresh.
if (-not ('ZeusBenchmarkProcessStatus' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ZeusBenchmarkProcessStatus {
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(SafeProcessHandle handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(SafeProcessHandle handle,out uint code);
    public static uint? ExitCode(Process process,uint milliseconds) {
        var handle=process.SafeHandle;
        uint waited=WaitForSingleObject(handle,milliseconds);
        if(waited==258)return null;
        if(waited!=0)throw new Win32Exception(Marshal.GetLastWin32Error());
        uint code;
        if(!GetExitCodeProcess(handle,out code))throw new Win32Exception(Marshal.GetLastWin32Error());
        return code;
    }
}
'@
}
