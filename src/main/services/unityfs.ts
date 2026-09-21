// ================= UnityFS 归档读取 =================
// 游戏的资源都打在 BrokenArrow_Data/data.unity3d 里（7 GB 左右）。这里只做一件事：
// 从里面按需读出某个节点（我们要 globalgamemanagers.assets）的**某一段字节**，
// 不解整包、也不往硬盘上落 640 MB 的临时文件。
//
// 归档的结构：头部 → 块表（每块记「解开多大、压缩后多大、怎么压的」）→ 节点表（每个文件在
// 解开后的逻辑地址空间里的偏移和长度）→ 数据区（一块接一块）。所以给定一段逻辑地址，
// 只要解开盖住这段的那几块就够了。
//
// 这一版只实现游戏实际用到的两种压缩：不压（0）和 LZ4（2/3）。撞上 LZMA 会直接报错，
// 上层退回「没有游戏数据」的老路子。
import { closeSync, openSync, readSync, statSync } from 'node:fs'

export interface FsBlock {
  /** 解开后的大小 */
  rawSize: number
  /** 文件里占的大小 */
  packedSize: number
  flags: number
  /** 在解开后的逻辑地址空间里的起点 */
  logical: number
  /** 在文件里的起点 */
  physical: number
}

export interface FsNode {
  offset: number
  size: number
  flags: number
}

/** LZ4 block 格式解压。标准算法：token → 字面量 → (偏移, 匹配长度) 循环。 */
export function lz4Decompress(src: Buffer, outSize: number): Buffer {
  const dst = Buffer.allocUnsafe(outSize)
  let s = 0
  let d = 0
  while (s < src.length) {
    const token = src[s++]
    let litLen = token >> 4
    if (litLen === 15) {
      let b: number
      do {
        b = src[s++]
        litLen += b
      } while (b === 255)
    }
    if (litLen > 0) {
      src.copy(dst, d, s, s + litLen)
      s += litLen
      d += litLen
    }
    // 最后一段只有字面量，没有匹配
    if (s >= src.length) break
    const offset = src[s++] | (src[s++] << 8)
    let matchLen = token & 15
    if (matchLen === 15) {
      let b: number
      do {
        b = src[s++]
        matchLen += b
      } while (b === 255)
    }
    matchLen += 4
    // 逐字节拷：匹配区可能和自己重叠（offset < matchLen 时就是在复读）
    let p = d - offset
    for (let i = 0; i < matchLen; i++) dst[d++] = dst[p++]
  }
  if (d !== outSize) throw new Error('LZ4 解出来 ' + d + ' 字节，块表说是 ' + outSize)
  return dst
}

function decompressBlock(data: Buffer, rawSize: number, flags: number): Buffer {
  const kind = flags & 0x3f
  if (kind === 0) return data
  if (kind === 2 || kind === 3) return lz4Decompress(data, rawSize)
  throw new Error('这个归档用了不支持的压缩方式（' + kind + '）')
}

/** 一个 UnityFS 归档：打开后可以按逻辑地址随机读某个节点 */
export class UnityFsArchive {
  private fd: number
  readonly blocks: FsBlock[] = []
  readonly nodes = new Map<string, FsNode>()

  constructor(readonly path: string) {
    this.fd = openSync(path, 'r')
    try {
      this.readIndex()
    } catch (e) {
      this.close()
      throw e
    }
  }

  close(): void {
    if (this.fd >= 0) {
      closeSync(this.fd)
      this.fd = -1
    }
  }

  /** 归档文件本身的大小和修改时间，拿来当「游戏版本戳」 */
  stamp(): string {
    const st = statSync(this.path)
    return st.size + ':' + Math.round(st.mtimeMs)
  }

  private at(pos: number, len: number): Buffer {
    const b = Buffer.allocUnsafe(len)
    let got = 0
    while (got < len) {
      const n = readSync(this.fd, b, got, len - got, pos + got)
      if (n <= 0) throw new Error('归档读到头了')
      got += n
    }
    return b
  }

  private readIndex(): void {
    // 头：UnityFS\0 + 版本 + 两个版本串 + 20 字节
    const head = this.at(0, 256)
    let p = head.indexOf(0)
    if (head.subarray(0, p).toString('latin1') !== 'UnityFS') throw new Error('不是 UnityFS 归档')
    p++
    const version = head.readUInt32BE(p)
    p += 4
    p = head.indexOf(0, p) + 1 // player version
    p = head.indexOf(0, p) + 1 // engine version
    const total = Number(head.readBigUInt64BE(p))
    const compressed = head.readUInt32BE(p + 8)
    const uncompressed = head.readUInt32BE(p + 12)
    const flags = head.readUInt32BE(p + 16)
    p += 20
    if (version >= 7) p = (p + 15) & ~15

    const infoOffset = flags & 0x80 ? total - compressed : p
    const info = decompressBlock(this.at(infoOffset, compressed), uncompressed, flags)

    let q = 16 // 跳过 hash
    const blockCount = info.readInt32BE(q)
    q += 4
    let logical = 0
    let physical = flags & 0x80 ? 64 : infoOffset + compressed
    if (!(flags & 0x80) && flags & 0x200) physical = (physical + 15) & ~15
    for (let i = 0; i < blockCount; i++) {
      const rawSize = info.readUInt32BE(q)
      const packedSize = info.readUInt32BE(q + 4)
      const bFlags = info.readUInt16BE(q + 8)
      q += 10
      this.blocks.push({ rawSize, packedSize, flags: bFlags, logical, physical })
      logical += rawSize
      physical += packedSize
    }
    const nodeCount = info.readInt32BE(q)
    q += 4
    for (let i = 0; i < nodeCount; i++) {
      const offset = Number(info.readBigInt64BE(q))
      const size = Number(info.readBigInt64BE(q + 8))
      const nFlags = info.readUInt32BE(q + 16)
      q += 20
      const end = info.indexOf(0, q)
      const name = info.subarray(q, end).toString('utf8')
      q = end + 1
      this.nodes.set(name, { offset, size, flags: nFlags })
    }
  }

  /** 解开第 i 块 */
  block(i: number): Buffer {
    const b = this.blocks[i]
    return decompressBlock(this.at(b.physical, b.packedSize), b.rawSize, b.flags)
  }

  /** 盖住 [from, to) 这段逻辑地址的块的下标范围 */
  blockRange(from: number, to: number): [number, number] {
    let lo = 0
    let hi = this.blocks.length - 1
    // 二分找起点
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.blocks[mid].logical <= from) lo = mid
      else hi = mid - 1
    }
    let end = lo
    while (end + 1 < this.blocks.length && this.blocks[end].logical + this.blocks[end].rawSize < to) end++
    return [lo, end]
  }

  /** 读某个节点里 [from, from+len) 的字节 */
  read(node: FsNode, from: number, len: number): Buffer {
    const start = node.offset + from
    const stop = Math.min(node.offset + node.size, start + len)
    const out = Buffer.alloc(Math.max(0, stop - start))
    const [a, b] = this.blockRange(start, stop)
    for (let i = a; i <= b; i++) {
      const blk = this.blocks[i]
      const data = this.block(i)
      const s = Math.max(start, blk.logical)
      const e = Math.min(stop, blk.logical + blk.rawSize)
      if (e > s) data.copy(out, s - start, s - blk.logical, e - blk.logical)
    }
    return out
  }

  /**
   * 在某个节点里**从尾巴往前**找一段字节，返回节点内的偏移（由后往前排）。
   * 倒着找是因为要找的东西（编译好的数据库）在资源文件的末尾，正着扫要解开整整 640 MB，
   * 倒着扫解个百分之几就撞上了。
   * @param want 找到几个就停（默认 1）
   * @param maxScanBytes 最多解多少字节，防止老是扫全文件
   */
  findFromEnd(node: FsNode, pattern: Buffer, want = 1, maxScanBytes = Infinity): number[] {
    const [first, last] = this.blockRange(node.offset, node.offset + node.size)
    const out: number[] = []
    let tail: Buffer = Buffer.alloc(0) // 上一轮（更靠后那块）的开头，接上去处理跨块的情况
    let scanned = 0
    for (let i = last; i >= first; i--) {
      const blk = this.blocks[i]
      const data = this.block(i)
      const buf = tail.length ? Buffer.concat([data, tail]) : data
      let from = buf.length
      for (;;) {
        const hit = buf.lastIndexOf(pattern, from - 1)
        if (hit < 0) break
        from = hit
        const abs = blk.logical + hit
        // 落在 tail 里的说明上一轮已经报过了
        if (hit < data.length && abs >= node.offset && abs + pattern.length <= node.offset + node.size) {
          out.push(abs - node.offset)
          if (out.length >= want) return out
        }
        if (hit === 0) break
      }
      tail = Buffer.from(data.subarray(0, Math.min(data.length, pattern.length - 1)))
      scanned += blk.rawSize
      if (scanned > maxScanBytes) break
    }
    return out
  }
}
