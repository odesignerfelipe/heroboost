using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace HeroBoost {
  public static class TimerResolution {
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
    [DllImport("ntdll.dll")] static extern int NtQueryTimerResolution(out uint minimum, out uint maximum, out uint current);
    static bool active;
    public static bool Active { get { return active; } }
    public static void Set(bool enabled) {
      if(enabled == active) return;
      uint code = enabled ? timeBeginPeriod(1) : timeEndPeriod(1);
      if(code != 0) throw new InvalidOperationException("O Windows recusou a solicitacao de timer.");
      active = enabled;
    }
    public static double[] Read() {
      uint min,max,current;
      int status=NtQueryTimerResolution(out min,out max,out current);
      if(status != 0) throw new InvalidOperationException("Timer query failed.");
      return new double[] { min/10000.0,max/10000.0,current/10000.0,active?1.0:0.0 };
    }
  }
  public class MouseReading {
    public long reports; public double seconds; public double hz; public double medianHz; public int devices;
  }
  public static class RawMouse {
    [StructLayout(LayoutKind.Sequential)] struct Device { public ushort page,usage; public uint flags; public IntPtr target; }
    [StructLayout(LayoutKind.Sequential)] struct Header { public uint type,size; public IntPtr device,wparam; }
    [DllImport("user32.dll",SetLastError=true)] static extern bool RegisterRawInputDevices(Device[] devices,uint count,uint size);
    [DllImport("user32.dll",SetLastError=true)] static extern uint GetRawInputData(IntPtr input,uint command,IntPtr data,ref uint size,uint headerSize);
    static readonly object gate=new object();
    static Thread thread; static Sink sink; static Stopwatch watch=new Stopwatch();
    static long reports; static Dictionary<IntPtr,List<double>> intervals=new Dictionary<IntPtr,List<double>>();
    static Dictionary<IntPtr,double> previous=new Dictionary<IntPtr,double>();
    static Exception startError;
    static ManualResetEvent ready=new ManualResetEvent(false);
    sealed class Sink : Form {
      protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
      public Sink() { ShowInTaskbar=false; Text="Hero Boost Raw Input"; var handle=Handle;
        Device[] devices={new Device{page=1,usage=2,flags=0x100,target=handle}};
        if(!RegisterRawInputDevices(devices,1,(uint)Marshal.SizeOf(typeof(Device))))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
      protected override void WndProc(ref Message message) {
        if(message.Msg==0x00ff) {
          uint size=0; uint headerSize=(uint)Marshal.SizeOf(typeof(Header));
          if(GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,headerSize)==0 && size>=headerSize+24 && size<4096){
            IntPtr data=Marshal.AllocHGlobal((int)size);
            try {
              if(GetRawInputData(message.LParam,0x10000003,data,ref size,headerSize)==size){
                Header header=(Header)Marshal.PtrToStructure(data,typeof(Header));
                if(header.type==0){
                  // RAWMOUSE x/y offsets are relative to its naturally aligned payload.
                  int x=Marshal.ReadInt32(data,(int)headerSize+12), y=Marshal.ReadInt32(data,(int)headerSize+16);
                  if(x!=0||y!=0) lock(gate){
                    double now=watch.Elapsed.TotalMilliseconds;
                    reports++;
                    if(!intervals.ContainsKey(header.device))intervals[header.device]=new List<double>();
                    if(previous.ContainsKey(header.device)){
                      double elapsed=now-previous[header.device];
                      if(elapsed>0.03&&elapsed<80&&intervals[header.device].Count<100000)intervals[header.device].Add(elapsed);
                    }
                    previous[header.device]=now;
                  }
                }
              }
            } finally {Marshal.FreeHGlobal(data);}
          }
        }
        base.WndProc(ref message);
      }
    }
    public static void Start() {
      Stop(); lock(gate){reports=0;intervals.Clear();previous.Clear();watch.Restart();}
      ready.Reset();startError=null;
      thread=new Thread(delegate(){try{sink=new Sink();ready.Set();Application.Run(sink);}catch(Exception e){startError=e;ready.Set();}});
      thread.IsBackground=true;thread.SetApartmentState(ApartmentState.STA);thread.Start();
      if(!ready.WaitOne(5000))throw new InvalidOperationException("Mouse capture initialization timed out.");
      if(startError!=null)throw startError;
    }
    public static MouseReading Read() {
      lock(gate){
        var values=new List<double>();foreach(var list in intervals.Values)values.AddRange(list);values.Sort();
        double seconds=watch.Elapsed.TotalSeconds;
        return new MouseReading{reports=reports,seconds=seconds,hz=seconds>0?reports/seconds:0,medianHz=values.Count>0?1000.0/values[values.Count/2]:0,devices=intervals.Count};
      }
    }
    public static MouseReading Stop() {
      if(sink!=null){try{if(!sink.IsDisposed)sink.BeginInvoke((MethodInvoker)delegate(){sink.Close();});}catch{}}
      if(thread!=null&&thread.IsAlive)thread.Join(1500);
      sink=null;thread=null;watch.Stop();return Read();
    }
  }
}
