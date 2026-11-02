// Same-privilege process lifetime guard. NOT an elevation broker or service.
// Atomically create suspended in a kill-on-close job, then run. A stable process
// handle watches the owner; PID reuse after OpenProcess cannot revive it.
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;

class ProcessHost {
    [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT {
        public BASIC_LIMIT Basic; public IO_COUNTERS Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
        public uint cb; public string reserved, desktop, title;
        public uint x,y,width,height,xChars,yChars,fill,flags;
        public ushort show, reservedSize; public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO Info; public IntPtr Attributes; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMIT info,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string file,StringBuilder command,IntPtr ps,IntPtr ts,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX start,out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr duplicate,uint access,bool inherit,uint options);
    static void Check(bool ok) { if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr value) { if(value!=IntPtr.Zero && value!=new IntPtr(-1))CloseHandle(value);value=IntPtr.Zero; }
    static IntPtr Standard(int id) {
        IntPtr copy;Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(id),GetCurrentProcess(),out copy,0,true,2));return copy;
    }
    static string Quote(string value) {
        StringBuilder text=new StringBuilder("\"");int slashes=0;
        foreach(char c in value) {
            if(c=='\\'){slashes++;continue;}
            if(c=='"'){text.Append('\\',slashes*2+1);text.Append(c);slashes=0;continue;}
            text.Append('\\',slashes);slashes=0;text.Append(c);
        }
        text.Append('\\',slashes*2);text.Append('"');return text.ToString();
    }
    static int Main(string[] args) {
        IntPtr owner=IntPtr.Zero,job=IntPtr.Zero;
        STARTUPINFO start=new STARTUPINFO();PROCESS_INFORMATION child=new PROCESS_INFORMATION();
        IntPtr attributes=IntPtr.Zero,jobValue=IntPtr.Zero,handleValue=IntPtr.Zero;
        bool attributesReady=false;
        bool attached=false;
        try {
            uint ownerPid;
            if(args.Length<2 || !UInt32.TryParse(args[0],out ownerPid))throw new ArgumentException();
            string executable=Path.GetFullPath(args[1]);
            if(!File.Exists(executable) || !String.Equals(Path.GetExtension(executable),".exe",StringComparison.OrdinalIgnoreCase))throw new ArgumentException();
            owner=OpenProcess(0x00100000,false,ownerPid);Check(owner!=IntPtr.Zero);
            job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
            EXTENDED_LIMIT limits=new EXTENDED_LIMIT();limits.Basic.Flags=0x2000;
            Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))));
            StringBuilder command=new StringBuilder(Quote(executable));
            for(int i=2;i<args.Length;i++){command.Append(' ');command.Append(Quote(args[i]));}
            start.cb=(uint)Marshal.SizeOf(typeof(STARTUPINFOEX));start.flags=0x100;
            start.input=Standard(-10);start.output=Standard(-11);start.error=Standard(-12);
            IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
            attributes=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attributes,2,0,ref size));attributesReady=true;
            jobValue=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobValue,job);
            Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000D),jobValue,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            handleValue=Marshal.AllocHGlobal(IntPtr.Size*3);
            Marshal.WriteIntPtr(handleValue,0,start.input);Marshal.WriteIntPtr(handleValue,IntPtr.Size,start.output);Marshal.WriteIntPtr(handleValue,IntPtr.Size*2,start.error);
            Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleValue,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero));
            STARTUPINFOEX extended=new STARTUPINFOEX();extended.Info=start;extended.Attributes=attributes;
            // JOB_LIST assigns at CreateProcess, removing the orphan-suspended
            // race if this guard is killed between creation and assignment.
            Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,Environment.CurrentDirectory,ref extended,out child));attached=true;
            Console.Error.WriteLine("LR_SUPERVISOR_CHILD="+child.pid);Console.Error.Flush();
            Check(ResumeThread(child.thread)!=UInt32.MaxValue);
            Close(ref child.thread);Close(ref start.input);Close(ref start.output);Close(ref start.error);
            uint ended=WaitForMultipleObjects(2,new IntPtr[]{owner,child.process},false,UInt32.MaxValue);
            if(ended==0)return 125;
            Check(ended==1);
            uint code;Check(GetExitCodeProcess(child.process,out code));return unchecked((int)code);
        } catch(Win32Exception error) {
            Console.Error.WriteLine("LR_SUPERVISOR_ERROR="+error.NativeErrorCode);return 126;
        } catch {
            // Never echo the command line: it may carry a Telegram secret.
            Console.Error.WriteLine("LR_SUPERVISOR_ERROR=INVALID_INPUT");return 126;
        } finally {
            if(child.process!=IntPtr.Zero && !attached)TerminateProcess(child.process,126);
            // Closing this handle kills target and descendants on normal exit;
            // Windows also closes it if this guard itself is terminated.
            Close(ref job);Close(ref child.thread);Close(ref child.process);Close(ref owner);
            Close(ref start.input);Close(ref start.output);Close(ref start.error);
            if(attributesReady)DeleteProcThreadAttributeList(attributes);
            if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
            if(jobValue!=IntPtr.Zero)Marshal.FreeHGlobal(jobValue);
            if(handleValue!=IntPtr.Zero)Marshal.FreeHGlobal(handleValue);
        }
    }
}
