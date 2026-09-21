#!/usr/bin/env python3
"""看一眼断箭某个方法的机器码，用来核对计算器里的公式。

游戏是 IL2CPP 打的：C# 先编成 C++ 再编成 x86-64，所以没有 IL 可读，只能反汇编。
这个脚本干三件事：
  1. 解 global-metadata.dat，按名字找到方法（拿到它的 token）
  2. 在 GameAssembly.dll 里找到对应程序集的 CodeGenModule，顺着 methodPointers 取到函数地址
  3. 用 capstone 反汇编，顺手把 rip 相对寻址的浮点常量读出来

用法：
    pip install capstone
    python tools/il2cpp-peek.py CalculateMissileHitChance
    python tools/il2cpp-peek.py --list get_Damage          # 只列出候选，不反汇编
    python tools/il2cpp-peek.py DealAOEDamage --count 200 --game-dir "D:/.../broken_arrow"

游戏更新之后偏移会变，重新跑一遍就行。
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\broken_arrow"
# 方法定义结构体的大小（metadata v31）。换版本的话这个可能要改，脚本会自己验一遍。
METHOD_SIZES = (36, 32, 40, 44, 48)


class Metadata:
    """global-metadata.dat：只解我们要的三张表（字符串、方法、镜像）"""

    def __init__(self, path: Path):
        self.d = path.read_bytes()
        magic, self.version = struct.unpack_from("<Ii", self.d, 0)
        if magic != 0xFAB11BAF:
            raise SystemExit("不是 global-metadata.dat")
        pairs = [struct.unpack_from("<ii", self.d, 8 + i * 8) for i in range(28)]
        self.str_off, self.str_size = pairs[2]
        self.m_off, self.m_size = pairs[5]
        self.msz = self._method_size()
        self.count = self.m_size // self.msz

    def _method_size(self) -> int:
        for size in METHOD_SIZES:
            if self.m_size % size:
                continue
            ok = 0
            for i in range(min(self.m_size // size, 2000)):
                if self.string(struct.unpack_from("<i", self.d, self.m_off + i * size)[0]):
                    ok += 1
            if ok > 1900:
                return size
        raise SystemExit("认不出方法定义的结构体大小，游戏可能换了 metadata 版本")

    def string(self, idx: int) -> str:
        if not 0 <= idx < self.str_size:
            return ""
        end = self.d.index(b"\0", self.str_off + idx)
        return self.d[self.str_off + idx : end].decode("utf-8", "replace")

    def find(self, name: str) -> list[dict]:
        out = []
        for i in range(self.count):
            o = self.m_off + i * self.msz
            nm = self.string(struct.unpack_from("<i", self.d, o)[0])
            if nm == name or (name.lower() in nm.lower() and len(name) > 6):
                token = struct.unpack_from("<I", self.d, o + 24)[0]
                out.append({"index": i, "name": nm, "token": token, "rid": token & 0xFFFFFF})
        return out


class Binary:
    """GameAssembly.dll：PE 解析 + 找 CodeGenModule 的方法指针表"""

    def __init__(self, path: Path):
        self.b = path.read_bytes()
        pe = struct.unpack_from("<I", self.b, 0x3C)[0]
        nsec = struct.unpack_from("<H", self.b, pe + 6)[0]
        optsz = struct.unpack_from("<H", self.b, pe + 20)[0]
        self.image_base = struct.unpack_from("<Q", self.b, pe + 24 + 24)[0]
        self.secs = []
        off = pe + 24 + optsz
        for i in range(nsec):
            o = off + i * 40
            vsize, va, rawsize, raw = struct.unpack_from("<IIII", self.b, o + 8)
            self.secs.append((va, vsize, raw, rawsize))

    def va2off(self, va: int) -> int | None:
        rva = va - self.image_base
        for v, vs, raw, rs in self.secs:
            if v <= rva < v + max(vs, rs):
                return raw + (rva - v)
        return None

    def off2va(self, o: int) -> int | None:
        for v, vs, raw, rs in self.secs:
            if raw <= o < raw + rs:
                return self.image_base + v + (o - raw)
        return None

    def method_pointers(self, module: str = "BrokenArrow.dll") -> tuple[int, int]:
        """按模块名找 CodeGenModule：它的第一个字段就是模块名字符串的指针"""
        needle = module.encode() + b"\0"
        pos = self.b.find(needle)
        if pos < 0:
            raise SystemExit(f"二进制里没有 {module}")
        va = self.off2va(pos)
        hits = []
        pat = struct.pack("<Q", va)
        start = 0
        while True:
            i = self.b.find(pat, start)
            if i < 0:
                break
            hits.append(i)
            start = i + 1
        for h in hits:
            count = struct.unpack_from("<Q", self.b, h + 8)[0]
            ptr = struct.unpack_from("<Q", self.b, h + 16)[0]
            o = self.va2off(ptr) if ptr > self.image_base else None
            if o and 100 < count < 1_000_000:
                return o, count
        raise SystemExit(f"{module} 的 methodPointers 没找到")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", help="方法名，比如 CalculateMissileHitChance")
    ap.add_argument("--game-dir", default=DEFAULT_GAME)
    ap.add_argument("--module", default="BrokenArrow.dll", help="方法所在的程序集")
    ap.add_argument("--count", type=int, default=80, help="最多反汇编几条指令")
    ap.add_argument("--list", action="store_true", help="只列候选，不反汇编")
    args = ap.parse_args()

    game = Path(args.game_dir)
    meta = Metadata(game / "BrokenArrow_Data" / "il2cpp_data" / "Metadata" / "global-metadata.dat")
    hits = meta.find(args.name)
    if not hits:
        raise SystemExit("没找到这个方法")
    print(f"metadata v{meta.version}，{meta.count} 个方法；匹配到 {len(hits)} 个：")
    for h in hits[:20]:
        print(f"  {h['name']}  token=0x{h['token']:08x} rid={h['rid']}")
    if args.list:
        return

    try:
        from capstone import CS_ARCH_X86, CS_MODE_64, Cs
    except ImportError:
        raise SystemExit("要反汇编先装 capstone：pip install capstone")

    binary = Binary(game / "GameAssembly.dll")
    mp, total = binary.method_pointers(args.module)
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    for h in hits[:4]:
        if h["rid"] > total:
            continue
        va = struct.unpack_from("<Q", binary.b, mp + (h["rid"] - 1) * 8)[0]
        o = binary.va2off(va)
        if not o:
            continue
        print(f"\n===== {h['name']}  VA 0x{va:x} =====")
        for n, ins in enumerate(md.disasm(binary.b[o : o + 4000], va)):
            extra = ""
            if "rip + " in ins.op_str and ins.mnemonic.endswith(("ss", "sd")):
                try:
                    disp = int(ins.op_str.split("rip + ")[1].split("]")[0], 16)
                    t = binary.va2off(ins.address + ins.size + disp)
                    if t:
                        val = struct.unpack_from("<f" if ins.mnemonic.endswith("ss") else "<d", binary.b, t)[0]
                        extra = f"    ; = {val:g}"
                except Exception:
                    pass
            print(f"  {ins.address:x}  {ins.mnemonic:<9} {ins.op_str}{extra}")
            if ins.mnemonic == "ret" or n >= args.count:
                break


if __name__ == "__main__":
    sys.exit(main())
