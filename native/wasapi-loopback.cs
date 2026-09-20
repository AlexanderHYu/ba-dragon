// WASAPI 回环采集：把「默认播放设备」正在播放的声音以原始 PCM 写到 stdout
// 用法：wasapi-loopback.exe（stdin 关闭即停止）
// stderr 第一行：FORMAT <采样率> <声道数> <位深> <f|i>；第二行：START <开始时刻 Unix 毫秒>
// 设备空闲时 WASAPI 不给数据，这里按时间补静音，保证音频时间轴与真实时间一致（便于和画面对齐）
// 用 Windows 自带的 .NET Framework csc 编译（C# 5 语法），由 src/audioLoopback.js 负责编译与缓存
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorCom { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
  int GetBufferSize(out uint frames);
  int GetStreamLatency(out long latency);
  int GetCurrentPadding(out uint padding);
  int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
  int GetMixFormat(out IntPtr format);
  int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
  int Start();
  int Stop();
  int Reset();
  int SetEventHandle(IntPtr handle);
  int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
  int ReleaseBuffer(uint frames);
  int GetNextPacketSize(out uint frames);
}

static class Program {
  const int eRender = 0, eConsole = 0, CLSCTX_ALL = 23;
  const int AUDCLNT_SHAREMODE_SHARED = 0, AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
  const uint AUDCLNT_BUFFERFLAGS_SILENT = 2;
  static volatile bool stop;

  static void Check(int hr, string what) {
    if (hr < 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8"));
  }

  static int Main() {
    try {
      var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice device;
      Check(enumerator.GetDefaultAudioEndpoint(eRender, eConsole, out device), "GetDefaultAudioEndpoint");
      Guid iidClient = typeof(IAudioClient).GUID;
      object o;
      Check(device.Activate(ref iidClient, CLSCTX_ALL, IntPtr.Zero, out o), "Activate");
      var client = (IAudioClient)o;
      IntPtr fmt;
      Check(client.GetMixFormat(out fmt), "GetMixFormat");
      int tag = Marshal.ReadInt16(fmt, 0) & 0xFFFF;
      int channels = Marshal.ReadInt16(fmt, 2);
      int rate = Marshal.ReadInt32(fmt, 4);
      int blockAlign = Marshal.ReadInt16(fmt, 12);
      int bits = Marshal.ReadInt16(fmt, 14);
      bool isFloat = tag == 3;
      if (tag == 0xFFFE) {
        // WAVEFORMATEXTENSIBLE：SubFormat GUID 在偏移 24，首 4 字节 3 = IEEE float，1 = PCM
        isFloat = Marshal.ReadInt32(fmt, 24) == 3;
        bits = Marshal.ReadInt16(fmt, 14);
      }
      Check(client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2000000, 0, fmt, IntPtr.Zero), "Initialize");
      Guid iidCapture = typeof(IAudioCaptureClient).GUID;
      Check(client.GetService(ref iidCapture, out o), "GetService");
      var capture = (IAudioCaptureClient)o;

      Console.Error.WriteLine("FORMAT " + rate + " " + channels + " " + bits + " " + (isFloat ? "f" : "i"));
      Stream stdout = Console.OpenStandardOutput();
      // stdin 关闭（父进程结束录制）即停止
      var watcher = new Thread(delegate () { try { Console.OpenStandardInput().Read(new byte[1], 0, 1); } catch { } stop = true; });
      watcher.IsBackground = true;
      watcher.Start();

      Check(client.Start(), "Start");
      long startTicks = Stopwatch.GetTimestamp();
      Console.Error.WriteLine("START " + (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds);
      long framesWritten = 0;
      byte[] buf = new byte[blockAlign * rate / 10];
      while (!stop) {
        uint packet;
        Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
        if (packet == 0) {
          // 设备空闲：落后真实时间超过 100ms 就补静音（留 20ms 余量给即将到来的数据）
          double elapsed = (Stopwatch.GetTimestamp() - startTicks) / (double)Stopwatch.Frequency;
          long lag = (long)(elapsed * rate) - framesWritten;
          if (lag > rate / 10) {
            long pad = lag - rate / 50;
            while (pad > 0) {
              int n = (int)Math.Min(pad, buf.Length / blockAlign);
              Array.Clear(buf, 0, n * blockAlign);
              stdout.Write(buf, 0, n * blockAlign);
              framesWritten += n;
              pad -= n;
            }
          }
          Thread.Sleep(5);
          continue;
        }
        while (packet > 0) {
          IntPtr data; uint frames, flags; ulong devPos, qpcPos;
          Check(capture.GetBuffer(out data, out frames, out flags, out devPos, out qpcPos), "GetBuffer");
          int bytes = (int)frames * blockAlign;
          if (buf.Length < bytes) buf = new byte[bytes];
          if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) Array.Clear(buf, 0, bytes);
          else Marshal.Copy(data, buf, 0, bytes);
          stdout.Write(buf, 0, bytes);
          framesWritten += frames;
          capture.ReleaseBuffer(frames);
          Check(capture.GetNextPacketSize(out packet), "GetNextPacketSize");
        }
      }
      client.Stop();
      stdout.Flush();
      return 0;
    } catch (Exception e) {
      Console.Error.WriteLine("ERROR " + e.Message);
      return 1;
    }
  }
}
