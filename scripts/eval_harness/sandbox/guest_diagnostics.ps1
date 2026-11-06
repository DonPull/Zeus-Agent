# Read-only diagnostics inside the disposable guest. No command lines or input.
$ErrorActionPreference='Stop'
$actorId=[int]$env:ZEUS_RUNTIME_ACTOR_PID
$all=@(Get-CimInstance Win32_Process)
$ids=New-Object 'Collections.Generic.HashSet[int]'
[void]$ids.Add($actorId)
for ($depth=0;$depth -lt 5;$depth++) {
    foreach ($item in $all) { if ($ids.Contains([int]$item.ParentProcessId)) { [void]$ids.Add([int]$item.ProcessId) } }
}
$rows=@(foreach ($item in $all) {
    if ($ids.Contains([int]$item.ProcessId)) {
        $process=Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
        $debugFlags=@([regex]::Matches($item.CommandLine,'--remote-debugging-(?:port|address|pipe)(?:=[^\s"]+)?') | ForEach-Object { $_.Value })
        [ordered]@{pid=$item.ProcessId;parent_pid=$item.ParentProcessId;name=$item.Name;executable=$item.ExecutablePath;window_title=$process.MainWindowTitle;responding=$process.Responding;debug_flags=$debugFlags}
    }
})
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ZeusGuestWindowDiagnostics {
    public delegate bool Callback(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb,IntPtr ctx);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback cb,IntPtr ctx);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder value,int count);
    public static string[] Read(uint pid) {
        var text=new List<string>();int remaining=8000;
        Callback child=(hwnd,ctx)=>{var value=new StringBuilder(2048);GetWindowText(hwnd,value,value.Capacity);if(value.Length>0&&text.Count<32&&remaining>0){var entry=value.ToString();if(entry.Length>remaining)entry=entry.Substring(0,remaining);text.Add(entry);remaining-=entry.Length;}return true;};
        Callback top=(hwnd,ctx)=>{uint owner;GetWindowThreadProcessId(hwnd,out owner);if(owner==pid){child(hwnd,ctx);EnumChildWindows(hwnd,child,ctx);}return true;};
        EnumWindows(top,IntPtr.Zero);return text.ToArray();
    }
}
'@
[ordered]@{processes=$rows;owned_window_text=[ZeusGuestWindowDiagnostics]::Read($actorId)} | ConvertTo-Json -Depth 8
