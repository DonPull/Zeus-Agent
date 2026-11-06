// Compiled and executed only inside the disposable Windows guest.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Collections.Generic;

public class ZeusCandidatePython {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimits value,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool belongs);
    static IntPtr ownedJob;
    static string Quote(string argument) {
        var result=new StringBuilder("\""); int slashes=0;
        foreach(char c in argument) {
            if(c=='\\'){slashes++;continue;}
            if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;}
            result.Append('\\',slashes);slashes=0;result.Append(c);
        }
        result.Append('\\',slashes*2);return result.Append('"').ToString();
    }
    public static int Main(string[] arguments) {
        try {
            if(!WindowsIdentity.GetCurrent().Name.EndsWith("\\WDAGUtilityAccount",StringComparison.OrdinalIgnoreCase))throw new Exception("Disposable guest controller identity required");
            var credential=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(@"C:\Zeus\GraderPrivate\candidate.json"));
            // Join before creating the candidate: descendants inherit this job.
            ownedJob=CreateJobObject(IntPtr.Zero,null);
            var limits=new ExtendedLimits();limits.Basic.Flags=0x2000; // KILL_ON_JOB_CLOSE, no breakaway.
            if(ownedJob==IntPtr.Zero||!SetInformationJobObject(ownedJob,9,ref limits,(uint)Marshal.SizeOf(limits))||!AssignProcessToJobObject(ownedJob,Process.GetCurrentProcess().Handle))throw new Exception("Cannot establish candidate process job: "+Marshal.GetLastWin32Error());
            var password=new SecureString();foreach(char c in credential["password"])password.AppendChar(c);password.MakeReadOnly();
            var info=new ProcessStartInfo(@"C:\Zeus\Runtime\browser\venv\Scripts\python.exe");
            info.Arguments="-I -B "+Quote(@"C:\Zeus\PublicTools\candidate_gate.py");
            info.UserName=credential["username"];info.Domain=Environment.MachineName;info.Password=password;
            info.UseShellExecute=false;info.CreateNoWindow=true;info.LoadUserProfile=true;
            string cwd=Environment.CurrentDirectory;
            info.WorkingDirectory=cwd.StartsWith(@"C:\Zeus\CandidateScratch\",StringComparison.OrdinalIgnoreCase)?cwd:@"C:\Zeus\CandidateScratch";
            info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
            info.EnvironmentVariables["TEMP"]=@"C:\Zeus\CandidateScratch";
            info.EnvironmentVariables["TMP"]=@"C:\Zeus\CandidateScratch";
            using(var child=Process.Start(info)) {
                bool belongs;
                if(!IsProcessInJob(child.Handle,ownedJob,out belongs)||(!belongs&&!AssignProcessToJobObject(ownedJob,child.Handle))) {child.Kill();throw new Exception("Candidate did not join its owned job");}
                // The trusted gate waits for this line before running any candidate.
                child.StandardInput.WriteLine(new JavaScriptSerializer().Serialize(arguments));child.StandardInput.Flush();
                Task.Run(async delegate {try {await Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream);child.StandardInput.Close();}catch(IOException){} });
                var output=child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
                var error=child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
                child.WaitForExit();Task.WaitAll(output,error);return child.ExitCode;
            }
            // The OS closes the retained job handle at process exit, reaping descendants.
        } catch(Exception error) { Console.Error.WriteLine("Candidate launcher: "+error.Message);return 125; }
    }
}
