using System;
using System.Text;
using System.IO;
using System.Diagnostics;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace HeroBoost {
  public class WindowFlags { public bool minimized; public bool visible; }
  public class MemoryStatus { public long total; public long available; public long commit; public long commitLimit; public double usedPercent; public long idleMs; public int foreground; public double? cpu; }
  public static class Performance {
    [StructLayout(LayoutKind.Sequential)] struct Memory { public uint length,load;public ulong totalPhys,availPhys,totalPage,availPage,totalVirtual,availVirtual,extended; }
    [StructLayout(LayoutKind.Sequential)] struct LastInput { public uint size,tick; }
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint low,high;public long Value { get {return ((long)high<<32)|low;} } }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
    delegate bool EnumWindow(IntPtr window,IntPtr parameter);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref Memory info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetSystemTimes(out FileTime idle,out FileTime kernel,out FileTime user);
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out FileTime created,out FileTime exited,out FileTime kernel,out FileTime user);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessIoCounters(IntPtr handle,out Io io);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder name,ref int size);
    [DllImport("psapi.dll",SetLastError=true)] static extern bool EmptyWorkingSet(IntPtr handle);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out int pid);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput input);
    static long previousIdle,previousTotal;
    public static int Foreground() {int pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);return pid;}
    public static long IdleMilliseconds() {var input=new LastInput{size=(uint)Marshal.SizeOf(typeof(LastInput))};if(!GetLastInputInfo(ref input))return 0;return unchecked((uint)Environment.TickCount-input.tick);}
    public static Dictionary<int,WindowFlags> Windows() {
      var result=new Dictionary<int,WindowFlags>();EnumWindows(delegate(IntPtr window,IntPtr parameter){if(IsWindowVisible(window)){int pid;GetWindowThreadProcessId(window,out pid);if(!result.ContainsKey(pid))result[pid]=new WindowFlags();if(IsIconic(window))result[pid].minimized=true;else result[pid].visible=true;}return true;},IntPtr.Zero);return result;
    }
    public static MemoryStatus Read() {
      var m=new Memory{length=(uint)Marshal.SizeOf(typeof(Memory))};if(!GlobalMemoryStatusEx(ref m))throw new Win32Exception(Marshal.GetLastWin32Error());
      double? cpu=null;FileTime idle,kernel,user;if(GetSystemTimes(out idle,out kernel,out user)){long total=kernel.Value+user.Value;if(previousTotal>0&&total>previousTotal)cpu=Math.Max(0,Math.Min(100,100.0*(1.0-(idle.Value-previousIdle)/(double)(total-previousTotal))));previousIdle=idle.Value;previousTotal=total;}
      return new MemoryStatus{total=(long)m.totalPhys,available=(long)m.availPhys,commit=(long)(m.totalPage-m.availPage),commitLimit=(long)m.totalPage,usedPercent=100.0*(m.totalPhys-m.availPhys)/m.totalPhys,idleMs=IdleMilliseconds(),foreground=Foreground(),cpu=cpu};
    }
    public static long IoBytes(int pid){IntPtr handle=OpenProcess(0x1000,false,pid);if(handle==IntPtr.Zero)return -1;try{Io io;if(!GetProcessIoCounters(handle,out io))return -1;return (long)(io.readBytes+io.writeBytes);}finally{CloseHandle(handle);}}
    public static bool Unlocked(string path){try{using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.None)){return true;}}catch{return false;}}
    static void ValidateHandle(IntPtr handle,string expectedPath,long creation) {
      FileTime created,exited,kernel,user;if(!GetProcessTimes(handle,out created,out exited,out kernel,out user))throw new Win32Exception(Marshal.GetLastWin32Error());
      var path=new StringBuilder(32768);int size=path.Capacity;if(created.Value!=creation||!QueryFullProcessImageName(handle,0,path,ref size)||!String.Equals(path.ToString(),expectedPath,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("O processo mudou; operacao cancelada.");
    }
    static void AssertMinimizedGroup(string path) {
      var windows=Windows();bool minimized=false;
      foreach(var process in Process.GetProcesses()) {
        using(process) {
          string candidate;try{candidate=process.MainModule.FileName;}catch{continue;}
          if(!String.Equals(candidate,path,StringComparison.OrdinalIgnoreCase))continue;
          WindowFlags flags;if(windows.TryGetValue(process.Id,out flags)){if(flags.visible)throw new InvalidOperationException("Uma janela do aplicativo voltou ao uso.");minimized|=flags.minimized;}
        }
      }
      if(!minimized)throw new InvalidOperationException("O aplicativo deixou de estar minimizado.");
    }
    public static long[] Trim(int pid,string path,long creation) {
      IntPtr handle=OpenProcess(0x1100,false,pid);if(handle==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
      try{
        ValidateHandle(handle,path,creation);var target=Process.GetProcessById(pid);var foreground=Foreground();
        try{if(foreground==pid||String.Equals(Process.GetProcessById(foreground).MainModule.FileName,path,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("O aplicativo esta em primeiro plano.");}catch(InvalidOperationException){throw;}catch{}
        AssertMinimizedGroup(path);ValidateHandle(handle,path,creation);
        long before=target.WorkingSet64;if(!EmptyWorkingSet(handle))throw new Win32Exception(Marshal.GetLastWin32Error());target.Refresh();return new long[]{before,target.WorkingSet64,target.PrivateMemorySize64};
      }finally{CloseHandle(handle);}
    }
  }
}
