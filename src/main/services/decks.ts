// ================= 卡组备份 / 部署 =================
// 游戏的卡组在 %USERPROFILE%\AppData\LocalLow\SteelBalalaikaStudio\BrokenArrow\Decks，
// 一个 .dek 一副。这里做三件事：
//   1. 每局开始自动把当前卡组打包成「上一局卡组包.zip」（只留一个，滚动覆盖）
//   2. 手动备份成带时间戳的包
//   3. 把某个包里的卡组还原回游戏目录（换号、重装之后用）
// 还原前先自动备份一份现有的，免得覆盖掉没备份过的卡组。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { zipCreate, zipExtract } from '@shared/zip'

const GAME_DIR = join(homedir(), 'AppData', 'LocalLow', 'SteelBalalaikaStudio', 'BrokenArrow')
const PKG_NAME = '上一局卡组包.zip'

export interface DeckFile {
  name: string
  size: number
  mtime: number
}
export interface BackupFile {
  name: string
  path: string
  size: number
  mtime: number
  decks: number
  auto: boolean
}

const stamp = (): string => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

/** 文件名安全校验：只收纯文件名，不许带路径 */
function safeName(name: string): string | null {
  if (!name) return null
  const base = basename(name)
  if (base !== name || name.includes('..') || /[\\/]/.test(name)) return null
  return base
}

export class DeckService {
  readonly decksDir = join(GAME_DIR, 'Decks')
  readonly backupDir: string

  constructor(dataDir: string) {
    this.backupDir = join(dataDir, 'deck-backups')
  }

  found(): boolean {
    return existsSync(this.decksDir)
  }

  list(): DeckFile[] {
    try {
      return readdirSync(this.decksDir)
        .filter((f) => f.toLowerCase().endsWith('.dek'))
        .map((f) => {
          const st = statSync(join(this.decksDir, f))
          return { name: f, size: st.size, mtime: st.mtimeMs }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }

  backups(): BackupFile[] {
    try {
      if (!existsSync(this.backupDir)) return []
      return readdirSync(this.backupDir)
        .filter((f) => f.toLowerCase().endsWith('.zip'))
        .map((f) => {
          const p = join(this.backupDir, f)
          const st = statSync(p)
          let decks = 0
          try {
            decks = zipExtract(readFileSync(p)).length
          } catch {
            decks = 0
          }
          return { name: f, path: p, size: st.size, mtime: st.mtimeMs, decks, auto: f === PKG_NAME }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }

  /**
   * 打包卡组。only 给了就只打包这几副（前线那栏「备份选中」），不给就全部。
   * name 不给就用时间戳。
   */
  backup(name?: string, only?: string[]): { file: string; decks: number } | { error: string } {
    let decks = this.list()
    if (only?.length) {
      const want = new Set(only.map((x) => safeName(x)).filter(Boolean) as string[])
      decks = decks.filter((d) => want.has(d.name))
    }
    if (!decks.length) return { error: only?.length ? '没选中卡组' : '游戏卡组目录里没有卡组' }
    const files = decks.map((d) => ({ name: d.name, data: readFileSync(join(this.decksDir, d.name)) }))
    const fileName = safeName(name || '卡组备份-' + stamp() + '.zip') || '卡组备份-' + stamp() + '.zip'
    mkdirSync(this.backupDir, { recursive: true })
    const out = join(this.backupDir, fileName)
    writeFileSync(out, zipCreate(files))
    return { file: out, decks: files.length }
  }

  /** 删卡组（前线那栏的「删除所选」）。删之前先整体备份一份，免得手滑 */
  deleteDecks(names: string[]): { removed: number; error?: string } {
    const want = (names || []).map((x) => safeName(x)).filter(Boolean) as string[]
    if (!want.length) return { removed: 0, error: '没选中卡组' }
    this.backup('删除前-' + stamp() + '.zip')
    let removed = 0
    for (const n of want) {
      try {
        unlinkSync(join(this.decksDir, n))
        removed++
      } catch {
        /* 删不掉就跳过 */
      }
    }
    return { removed }
  }

  /** 删备份包（后勤那栏的「删除所选」） */
  deleteBackups(names: string[]): { removed: number; error?: string } {
    const want = (names || []).map((x) => safeName(x)).filter(Boolean) as string[]
    if (!want.length) return { removed: 0, error: '没选中备份' }
    let removed = 0
    for (const n of want) {
      try {
        unlinkSync(join(this.backupDir, n))
        removed++
      } catch {
        /* 删不掉就跳过 */
      }
    }
    return { removed }
  }

  /** 每局开始自动覆盖「上一局卡组包」 */
  autoBackup(): void {
    try {
      this.backup(PKG_NAME)
    } catch {
      /* 备份失败不影响打游戏 */
    }
  }

  /** 把备份包里的卡组还原回游戏目录；先自动备份现有的 */
  restore(name: string, opts: { overwrite?: boolean } = {}): { restored: number; skipped: string[] } | { error: string } {
    const file = safeName(name)
    if (!file) return { error: '文件名不合法' }
    const p = join(this.backupDir, file)
    if (!existsSync(p)) return { error: '找不到这个备份' }
    if (!this.found()) return { error: '没找到游戏的卡组目录' }
    let entries
    try {
      entries = zipExtract(readFileSync(p)).filter((e) => e.name.toLowerCase().endsWith('.dek'))
    } catch (e) {
      return { error: '备份包读不出来：' + String((e as Error).message) }
    }
    if (!entries.length) return { error: '这个包里没有卡组' }
    this.backup('还原前-' + stamp() + '.zip')
    let restored = 0
    const skipped: string[] = []
    for (const e of entries) {
      const n = safeName(e.name)
      if (!n) continue
      const target = join(this.decksDir, n)
      if (existsSync(target) && !opts.overwrite) {
        skipped.push(n)
        continue
      }
      writeFileSync(target, e.data)
      restored++
    }
    return { restored, skipped }
  }
}
