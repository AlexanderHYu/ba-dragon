// ================= 游戏自带的单位数据库 =================
// 游戏把单位、配装、价格编译成一张表，加密后塞在 data.unity3d 里的
// globalgamemanagers.assets → DataBaseCompiled 这个对象里。卡组文件（.dek）用的是同一套加密。
//
// 拿到它能解决两件我们一直做不准的事：
//   1. 配装有真名了（「配装 A / B」→「M1A1 FEP Trophy」「Ka-50Sh Akula」）
//   2. 花费是精确值（单位基础价 + 每个配装选项的加价），不用再按总数等比例摊
// 在 31 局真实对局、5427 条出兵记录上验过：按这个算出来的出兵分和回收分，
// 和 BATrace 的官方数字一个子儿不差。
//
// 加密用的密钥跟着游戏版本走，本仓库不带，由用户自己在设置里填。没填就退回老路子（估算）。
import { createDecipheriv } from 'node:crypto'
import { UnityFsArchive, type FsNode } from './unityfs'
import type { Db } from './db'
import type { DeckView } from '@shared/ipc'

/** 编译数据库里 24 张表的顺序，少一张都对不上 */
const FIELDS = [
  'Units',
  'AbilitiesJson',
  'UnitAbilitiesJson',
  'AmmunitionsJson',
  'ArmorsJson',
  'MobilityJson',
  'FlyPresetsJson',
  'UnitPropulsionsJson',
  'CountriesJson',
  'TurretsJson',
  'TurretUnitsJson',
  'WeaponsJson',
  'TurretWeaponsJson',
  'WeaponAmmunitionsJson',
  'SensorUnitsJson',
  'SensorsJson',
  'SquadMembersJson',
  'SquadWeaponsJson',
  'ModificationsJson',
  'OptionsJson',
  'UnitArmorsJson',
  'SpecializationAvailabilitiesJson',
  'SpecializationsJson',
  'TransportAvailabilitiesJson'
] as const

/** 我们只解这几张，其余的跳过（省时间也省内存） */
const WANTED = new Set(['Units', 'ModificationsJson', 'OptionsJson', 'SpecializationsJson', 'CountriesJson'])

const ASSET_NODE = 'globalgamemanagers.assets'
const OBJ_NAME = 'DataBaseCompiled'
const MARKER = Buffer.from('fhk3s0g3')
/** 数据库对象在资源文件末尾，往前扫这么多就该找到了；找不到再扫全文件 */
const TAIL_SCAN = 128 * 1024 * 1024

export interface GameUnit {
  id: number
  /** 游戏里显示的名字（HUDName，没有就用 Name） */
  name: string
  cost: number
  countryId: number
  category: number
  role: number
}

export interface GameOption {
  id: number
  unitId: number
  /** 属于哪个槽位 */
  modId: number
  cost: number
  /** 内部名，形如 "MainTurret StrykerMGS MK19" */
  name: string
  /** 界面名，有时是人话（"8x Mk.82 500lb"），有时是本地化 key（Custom_Option_xxx） */
  uiName: string
  /** 选了它整个单位改名 */
  replace: string | null
  /** 选了它在单位名后面接一段 */
  concat: string | null
}

export interface GameSlot {
  id: number
  unitId: number
  name: string
  order: number
}

/** 专精（卡组选的那两个） */
export interface GameSpec {
  id: number
  countryId: number
  name: string
  maxSlots: number
}

export interface GameTables {
  stamp: string
  units: GameUnit[]
  options: GameOption[]
  slots: GameSlot[]
  specs: GameSpec[]
  countries: { id: number; name: string }[]
}

/** 一套配装解出来的样子 */
export interface Loadout {
  /** 带配装的完整名字，如「M1A1 FEP Trophy」 */
  name: string
  /** 这一套的精确单价 */
  cost: number
  /** 挂了什么：每个非空选项一条 */
  parts: { label: string; cost: number }[]
}

// ---------- 解密 ----------

/** 游戏的加密：明文前缀 fhk3s0g3 + 16 字节 IV + AES-256-CBC，整体再 base64（卡组文件不套 base64） */
export function decryptBlob(buf: Buffer, key: string): Buffer {
  if (!buf.subarray(0, MARKER.length).equals(MARKER)) {
    throw new Error('这段数据不是游戏加密格式（开头对不上）')
  }
  const iv = buf.subarray(MARKER.length, MARKER.length + 16)
  const body = buf.subarray(MARKER.length + 16)
  const d = createDecipheriv('aes-256-cbc', Buffer.from(key, 'ascii'), iv)
  return Buffer.concat([d.update(body), d.final()])
}

function decryptJson(base64: Buffer, key: string): unknown {
  const plain = decryptBlob(Buffer.from(base64.toString('latin1'), 'base64'), key)
  // 解出来的 JSON 后面可能跟着填充，截到最后一个闭合括号
  const text = plain.toString('utf8')
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
  return JSON.parse(end >= 0 ? text.slice(0, end + 1) : text)
}

/** 卡组文件（.dek）：同一把钥匙，解出来是 JSON */
export function decodeDeckFile(buf: Buffer, key: string): unknown {
  const plain = decryptBlob(buf, key)
  const text = plain.toString('utf8')
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
  return JSON.parse(end >= 0 ? text.slice(0, end + 1) : text)
}

// ---------- 从归档里读出那张表 ----------

/** 顺着往下读的游标：需要多少就从归档里再解一段出来 */
class Cursor {
  private buf: Buffer
  private end: number
  constructor(
    private fs: UnityFsArchive,
    private node: FsNode,
    private base: number,
    private chunk = 8 * 1024 * 1024
  ) {
    this.buf = fs.read(node, base, chunk)
    this.end = this.buf.length
  }
  private need(n: number): void {
    if (n <= this.end) return
    const want = Math.max(n, this.end * 2)
    this.buf = this.fs.read(this.node, this.base, want)
    this.end = this.buf.length
    if (n > this.end) throw new Error('数据库对象读到节点末尾了')
  }
  /** Unity 的字符串：4 字节长度 + 内容，然后补齐到 4 的倍数 */
  string(offset: number): [Buffer, number] {
    this.need(offset + 4)
    const size = this.buf.readUInt32LE(offset)
    if (size < 0 || size > 64 * 1024 * 1024) throw new Error('字符串长度不像话：' + size)
    this.need(offset + 4 + size)
    const data = this.buf.subarray(offset + 4, offset + 4 + size)
    return [data, (offset + 4 + size + 3) & ~3]
  }
}

interface RawUnit {
  Id: number
  Name: string
  HUDName: string | null
  Cost: number
  CountryId: number
  CategoryType: number
  Role: number
}
interface RawOption {
  Id: number
  ModificationId: number
  Cost: number
  Name: string
  UIName: string | null
  ReplaceUnitName: string | null
  ConcatenateWithUnitName: string | null
}
interface RawMod {
  Id: number
  UnitId: number
  Name: string
  Order: number
}
interface RawSpec {
  Id: number
  CountryId: number
  Name: string
  MaxSlots: number
}
interface RawCountry {
  Id: number
  Name: string
}

/** 从游戏目录里把单位表读出来。key 不对 / 游戏换了格式都会抛错。 */
export function extractTables(gameDir: string, key: string): GameTables {
  const archive = gameDir.replace(/[\\/]+$/, '') + '/BrokenArrow_Data/data.unity3d'
  const fs = new UnityFsArchive(archive)
  try {
    const node = fs.nodes.get(ASSET_NODE)
    if (!node) throw new Error('归档里没有 ' + ASSET_NODE)
    // 对象名是一条 Unity 字符串，正好可以当特征码找
    const pattern = Buffer.concat([Buffer.from([OBJ_NAME.length, 0, 0, 0]), Buffer.from(OBJ_NAME, 'ascii')])
    let hits = fs.findFromEnd(node, pattern, 2, TAIL_SCAN)
    if (!hits.length) hits = fs.findFromEnd(node, pattern, 2)
    if (!hits.length) throw new Error('资源里找不到 ' + OBJ_NAME + '，游戏的存法可能变了')

    let best: GameTables | null = null
    for (const hit of hits) {
      let tables: GameTables
      try {
        tables = readOne(fs, node, hit, key)
      } catch {
        continue // 这个对象读不出来就试下一个
      }
      if (!best || tables.units.length > best.units.length) best = tables
    }
    if (!best) throw new Error('数据库解不开，密钥可能不对（游戏更新后会换）')
    return best
  } finally {
    fs.close()
  }
}

function readOne(fs: UnityFsArchive, node: FsNode, nameOffset: number, key: string): GameTables {
  const cur = new Cursor(fs, node, nameOffset)
  let [name, off] = cur.string(0)
  if (name.toString('ascii') !== OBJ_NAME) throw new Error('对象名对不上')
  const raw: Record<string, unknown> = {}
  for (const field of FIELDS) {
    const [data, next] = cur.string(off)
    off = next
    if (WANTED.has(field)) raw[field] = decryptJson(data, key)
  }
  const units = (raw.Units as RawUnit[]) || []
  const mods = (raw.ModificationsJson as RawMod[]) || []
  const options = (raw.OptionsJson as RawOption[]) || []
  const specs = (raw.SpecializationsJson as RawSpec[]) || []
  const countries = (raw.CountriesJson as RawCountry[]) || []
  const modUnit = new Map(mods.map((m) => [m.Id, m.UnitId]))
  return {
    stamp: fs.stamp(),
    units: units.map((u) => ({
      id: u.Id,
      name: (u.HUDName || u.Name || '').trim(),
      cost: Number(u.Cost) || 0,
      countryId: Number(u.CountryId) || 0,
      category: Number(u.CategoryType) || 0,
      role: Number(u.Role) || 0
    })),
    options: options.map((o) => ({
      id: o.Id,
      unitId: modUnit.get(o.ModificationId) || 0,
      modId: o.ModificationId,
      cost: Number(o.Cost) || 0,
      name: o.Name || '',
      uiName: o.UIName || '',
      replace: o.ReplaceUnitName || null,
      concat: o.ConcatenateWithUnitName || null
    })),
    slots: mods.map((m) => ({
      id: m.Id,
      unitId: m.UnitId,
      name: m.Name || '',
      order: Number(m.Order) || 0
    })),
    specs: specs.map((x) => ({
      id: x.Id,
      countryId: x.CountryId,
      name: x.Name || '',
      maxSlots: Number(x.MaxSlots) || 0
    })),
    countries: countries.map((c) => ({ id: c.Id, name: c.Name || '' }))
  }
}

// ---------- 给上层用的服务 ----------

/** 槽位类的词：名字开头这些一律去掉（"MainTurret StrykerMGS MK19" 里的 MainTurret） */
const SLOT_WORD =
  /^(option|options|loadout|variant|armor|aps|ecm|engine|optics|sensors?|mobility|propulsion|abilit(y|ies)|squad|transport|ammo|ammunition|weapons?|mainweapon|turrets?|nestedturret|rearturret|.*turret|.*pylons?|wingtips?|fuselage|centerline|slot)$/i

const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '')
const commonPrefix = (a: string, b: string): number => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * 选项显示名。界面名是人话就直接用（"8x Mk.82 500lb"），是本地化 key 的话就从内部名里凑：
 * 去掉开头的槽位词、去掉重复的单位名，剩下的就是挂了什么（"InnerPylons Su25SM 2xKh29ML" → "2xKh29ML"）。
 * 游戏的本地化文本不在这个文件里，所以只能这么凑。
 */
export function optionLabel(o: GameOption, unitName = ''): string {
  const ui = (o.uiName || '').trim()
  // 本地化 key 长这样：Custom_Option_8xMissiles、dlc_3_Custom_Option_40N6、ui_spec_xxx
  const isKey = /(^|_)(custom|ui)_/i.test(ui)
  if (ui && !isKey) return ui
  const un = norm(unitName)
  const toks = (o.name || '').trim().split(/\s+/)
  while (toks.length && SLOT_WORD.test(toks[0])) toks.shift()
  const kept = toks.filter((t) => {
    const nt = norm(t)
    if (!nt) return false
    if (!un) return true
    // 名字里重复写了单位型号（写法还常常和显示名不一样：Su25SM / Su-25SM）
    return !(nt.includes(un) || un.includes(nt) || (nt.length >= 5 && commonPrefix(nt, un) >= 5))
  })
  if (kept.length) return kept.join(' ')
  return ui.replace(/^.*?Custom_(Option|Slot)_?/i, '').replace(/_/g, ' ') || o.name
}

/** 空槽位/默认件，不值得在挂载里占一行 */
export const isBlankOption = (label: string): boolean =>
  !label || /^(empty|base|default|none|nothing|standard)$/i.test(label)

/** .dek 解出来长这样 */
interface RawDeck {
  name?: string
  country?: number
  spec1?: number
  spec2?: number
  set2?: Record<
    string,
    {
      unitId: number
      tranId?: number
      count?: number
      modList?: { optId: number }[]
      modListTr?: { optId: number }[]
    }[]
  >
}

/** 卡组里的分类，顺序照游戏 */
const DECK_CATS: [string, string][] = [
  ['Recon', '侦察'],
  ['Infantry', '步兵'],
  ['GroundCombatVehicles', '装甲'],
  ['Support', '支援'],
  ['Logistic', '后勤'],
  ['Helicopters', '直升机'],
  ['Aircrafts', '空军']
]

export class GameDbService {
  private tables: GameTables | null = null
  private unitById = new Map<number, GameUnit>()
  private optById = new Map<number, GameOption>()
  /** 上一次出错的原因，界面上显示 */
  lastError: string | null = null

  constructor(
    private db: Db,
    private gameDir: () => string,
    private key: () => string
  ) {}

  get ready(): boolean {
    return !!this.tables
  }

  status(): {
    ready: boolean
    units: number
    options: number
    stamp: string | null
    error: string | null
  } {
    return {
      ready: this.ready,
      units: this.tables?.units.length || 0,
      options: this.tables?.options.length || 0,
      stamp: this.tables?.stamp || null,
      error: this.lastError
    }
  }

  /** 开软件时调一次：有缓存直接用，游戏更新了（归档大小/时间变了）就重新抓 */
  load(force = false): boolean {
    const key = (this.key() || '').trim()
    if (!key) {
      this.tables = null
      this.lastError = null // 没填密钥不算错
      return false
    }
    if (key.length !== 32) {
      this.lastError = '密钥要正好 32 个字符'
      return false
    }
    const dir = this.gameDir()
    if (!dir) {
      this.lastError = '还没设置游戏目录'
      return false
    }
    let stamp = ''
    try {
      const fs = new UnityFsArchive(dir.replace(/[\\/]+$/, '') + '/BrokenArrow_Data/data.unity3d')
      stamp = fs.stamp()
      fs.close()
    } catch (e) {
      this.lastError = '打不开游戏资源：' + String((e as Error)?.message || e)
      return false
    }
    if (!force) {
      const cached = this.readCache()
      if (cached && cached.stamp === stamp) {
        this.use(cached)
        return true
      }
    }
    try {
      const t = extractTables(dir, key)
      this.writeCache(t)
      this.use(t)
      this.lastError = null
      return true
    } catch (e) {
      this.tables = null
      this.lastError = String((e as Error)?.message || e)
      return false
    }
  }

  private use(t: GameTables): void {
    this.tables = t
    this.unitById = new Map(t.units.map((u) => [u.id, u]))
    this.optById = new Map(t.options.map((o) => [o.id, o]))
  }

  private readCache(): GameTables | null {
    try {
      const raw = this.db.meta('gameDb')
      return raw ? (JSON.parse(raw) as GameTables) : null
    } catch {
      return null
    }
  }

  private writeCache(t: GameTables): void {
    try {
      this.db.setMeta('gameDb', JSON.stringify(t))
    } catch {
      /* 缓存写不进去就下次再抓 */
    }
  }

  spec(id: number): GameSpec | null {
    return this.tables?.specs.find((x) => x.id === id) || null
  }

  country(id: number): string {
    return this.tables?.countries.find((c) => c.id === id)?.name || ''
  }

  unit(id: number): GameUnit | null {
    return this.unitById.get(id) || null
  }

  option(id: number): GameOption | null {
    return this.optById.get(id) || null
  }

  /** 单位 + 一串配装 → 真名、精确单价、挂载明细。数据不全就返回 null，上层退回估算。 */
  loadout(unitId: number, optionIds: number[] | undefined): Loadout | null {
    const u = this.unitById.get(unitId)
    if (!u) return null
    let name = u.name
    let cost = u.cost
    const tail: string[] = []
    const parts: { label: string; cost: number }[] = []
    for (const id of optionIds || []) {
      const o = this.optById.get(Number(id))
      if (!o) return null // 有一个查不到就整套不作数，免得算出个半吊子价钱
      cost += o.cost
      if (o.replace) name = o.replace
      if (o.concat) tail.push(o.concat)
      const label = optionLabel(o, u.name)
      if (!isBlankOption(label)) parts.push({ label, cost: o.cost })
    }
    const full = name + tail.join('')
    // 有些选项的标签就是单位名本身（选型号的那种槽位），没必要再念一遍
    const nf = norm(full)
    return { name: full, cost, parts: parts.filter((x) => !nf.includes(norm(x.label))) }
  }

  /**
   * 把 .dek 解出来的原始 JSON 整理成能直接显示的样子：
   * 分类 → 每张卡（单位真名、挂了什么、单价、几张、带什么运输车）。
   */
  describeDeck(raw: unknown, fileName: string): DeckView | { error: string } {
    if (!this.tables) return { error: 'noGameDb' }
    const d = raw as RawDeck
    const set = d?.set2 || {}
    const cats: DeckView['cats'] = []
    let cards = 0
    for (const [key, label] of DECK_CATS) {
      const list = set[key]
      if (!Array.isArray(list) || !list.length) continue
      const items = list
        .filter((c) => !!c?.unitId) // 空卡位
        .map((c) => {
          const main = this.loadout(
            c.unitId,
            (c.modList || []).map((m) => m.optId)
          )
          const tran = c.tranId
            ? this.loadout(
                c.tranId,
                (c.modListTr || []).map((m) => m.optId)
              )
            : null
          cards += Number(c.count) || 0
          return {
            unitId: c.unitId,
            name: main?.name || '单位#' + c.unitId,
            loadout: (main?.parts || []).map((p) => p.label).join(' · '),
            cost: main?.cost || 0,
            count: Number(c.count) || 0,
            transport: tran?.name || null,
            transportCost: tran?.cost || 0
          }
        })
      cats.push({ key, label, items })
    }
    return {
      name: String(d?.name || fileName.replace(/\.dek$/i, '')),
      country: this.country(Number(d?.country) || 0),
      specs: [d?.spec1, d?.spec2].map((x) => (x ? this.spec(Number(x))?.name || '' : '')).filter(Boolean) as string[],
      cards,
      cats
    }
  }

  /** 导出给渲染进程/纯逻辑用的精简表：单位价 + 选项价和改名规则 */
  priceTable(): {
    units: Record<number, [string, number]>
    options: Record<number, [number, string | null, string | null, string]>
  } | null {
    if (!this.tables) return null
    const units: Record<number, [string, number]> = {}
    for (const u of this.tables.units) units[u.id] = [u.name, u.cost]
    const options: Record<number, [number, string | null, string | null, string]> = {}
    for (const o of this.tables.options) {
      const label = optionLabel(o, this.unitById.get(o.unitId)?.name || '')
      options[o.id] = [o.cost, o.replace, o.concat, isBlankOption(label) ? '' : label]
    }
    return { units, options }
  }
}
