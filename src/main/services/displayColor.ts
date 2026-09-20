// ================= 显示器 HDR 状态（Windows DisplayConfig API） =================
// Chromium 只能告诉我们「高级颜色」开没开，分不清是 HDR 还是 Win11 的自动颜色管理（ACM，仍是 SDR），
// 也拿不到「SDR 内容亮度」。这里用 PowerShell 编译一小段 C# 直接问系统：
//   advancedColorEnabled && !wideColorEnforced → 真 HDR；wideColorEnforced → ACM（SDR）
//   SDRWhiteLevel / 1000 × 80 = SDR 白（尼特），色调映射要以它为基准
import { execFile } from 'node:child_process'

const CS = `
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class BaDisplayColor {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint n; public uint d; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_SOURCE { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_TARGET { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation; public uint scaling; public RATIONAL refreshRate; public uint scanLineOrdering; public int targetAvailable; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_INFO { public PATH_SOURCE sourceInfo; public PATH_TARGET targetInfo; public uint flags; }
  [StructLayout(LayoutKind.Sequential, Size = 64)] public struct MODE_INFO { public uint infoType; public uint id; public LUID adapterId; }
  [StructLayout(LayoutKind.Sequential)] public struct HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct TARGET_NAME { public HEADER header; public uint flags; public uint outputTechnology; public ushort edidManufactureId; public ushort edidProductCodeId; public uint connectorInstance; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string friendlyName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string devicePath; }
  [StructLayout(LayoutKind.Sequential)] public struct ADV_COLOR { public HEADER header; public uint value; public uint colorEncoding; public uint bitsPerColorChannel; }
  [StructLayout(LayoutKind.Sequential)] public struct SDR_WHITE { public HEADER header; public uint level; }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPath, out uint numMode);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint numPath, [Out] PATH_INFO[] paths, ref uint numMode, [Out] MODE_INFO[] modes, IntPtr topo);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TARGET_NAME r);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref ADV_COLOR r);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SDR_WHITE r);
  static HEADER H(uint type, int size, PATH_TARGET t) { var h = new HEADER(); h.type = type; h.size = (uint)size; h.adapterId = t.adapterId; h.id = t.id; return h; }
  public static string Query() {
    uint np, nm;
    if (GetDisplayConfigBufferSizes(2, out np, out nm) != 0) return "[]";
    var paths = new PATH_INFO[np]; var modes = new MODE_INFO[nm];
    if (QueryDisplayConfig(2, ref np, paths, ref nm, modes, IntPtr.Zero) != 0) return "[]";
    var items = new List<string>();
    for (int i = 0; i < np; i++) {
      var t = paths[i].targetInfo;
      var name = new TARGET_NAME(); name.header = H(2, Marshal.SizeOf(typeof(TARGET_NAME)), t); DisplayConfigGetDeviceInfo(ref name);
      var adv = new ADV_COLOR(); adv.header = H(9, Marshal.SizeOf(typeof(ADV_COLOR)), t); int ra = DisplayConfigGetDeviceInfo(ref adv);
      var sw = new SDR_WHITE(); sw.header = H(11, Marshal.SizeOf(typeof(SDR_WHITE)), t); int rs = DisplayConfigGetDeviceInfo(ref sw);
      string fn = (name.friendlyName ?? "").Replace("\\\\", "").Replace("\\"", "");
      items.Add("{\\"name\\":\\"" + fn + "\\",\\"advOk\\":" + (ra == 0 ? "true" : "false")
        + ",\\"supported\\":" + ((adv.value & 1) != 0 ? "true" : "false")
        + ",\\"enabled\\":" + ((adv.value & 2) != 0 ? "true" : "false")
        + ",\\"wideColorEnforced\\":" + ((adv.value & 4) != 0 ? "true" : "false")
        + ",\\"bpc\\":" + adv.bitsPerColorChannel
        + ",\\"sdrWhiteNits\\":" + (rs == 0 ? (sw.level / 1000.0 * 80.0).ToString(System.Globalization.CultureInfo.InvariantCulture) : "null") + "}");
    }
    return "[" + string.Join(",", items) + "]";
  }
}`

/** 单块显示器的颜色状态；sdrWhiteNits 为 null 表示系统没给出 */
export interface DisplayColorInfo {
  /** DisplayConfig 的 friendlyName，与 Electron display.label 同源 */
  name: string
  /** 真 HDR（高级颜色已开且不是 ACM） */
  hdr: boolean
  /** Win11 的自动颜色管理：开了「高级颜色」但内容仍按 SDR 合成 */
  acm: boolean
  /** SDR 内容亮度（尼特） */
  sdrWhiteNits: number | null
  /** 每通道位深 */
  bpc: number
}

let cache: DisplayColorInfo[] | null = null
let cacheAt = 0

/** 返回 [{ name, hdr, acm, sdrWhiteNits, bpc }]；失败返回 []（不影响录制，按 SDR 处理） */
export function queryDisplayColor(): Promise<DisplayColorInfo[]> {
  if (cache && Date.now() - cacheAt < 30000) return Promise.resolve(cache)
  return new Promise((resolve) => {
    const ps = 'Add-Type -TypeDefinition $env:BA_DC_CS -Language CSharp; [BaDisplayColor]::Query()'
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 20000, env: { ...process.env, BA_DC_CS: CS } },
      (_err, stdout) => {
        let list: DisplayColorInfo[] = []
        try {
          const raw: unknown = JSON.parse(String(stdout || '').trim() || '[]')
          list = (Array.isArray(raw) ? raw : []).map((item) => {
            const d = (item ?? {}) as Record<string, unknown>
            return {
              name: String(d.name ?? ''),
              hdr: !!(d.enabled && !d.wideColorEnforced),
              acm: !!(d.enabled && d.wideColorEnforced),
              sdrWhiteNits: typeof d.sdrWhiteNits === 'number' ? d.sdrWhiteNits : null,
              bpc: Number(d.bpc)
            }
          })
        } catch {
          list = []
        }
        cache = list
        cacheAt = Date.now()
        resolve(list)
      }
    )
  })
}

/** 按显示器友好名（Electron display.label 与 DisplayConfig 的 friendlyName 同源）找状态 */
export async function colorInfoFor(label?: string | null): Promise<DisplayColorInfo | null> {
  const list = await queryDisplayColor()
  if (!list.length) return null
  return list.find((d) => d.name && label && d.name === label) || (list.length === 1 ? list[0] : null)
}
