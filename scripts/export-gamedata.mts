// 把游戏自带的单位表导出成软件自带的那一份（src/shared/game/data.json）。
//
//   npx vite-node scripts/export-gamedata.mts -- --key <32位密钥> [--game-dir <游戏目录>]
//   密钥也可以放环境变量 BA_GAME_KEY，或者直接在软件「设置」里填好——都没给的话会去读那份设置
//
// 游戏每次大更新之后跑一遍、提交，没有密钥的人也就跟着有了新数据。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractRaw, rawToTables, tablesToData, WANTED_COMBAT } from '../src/main/services/gameDb'
import { buildCombat } from '../src/main/services/combatBuild'

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}

// 密钥优先用命令行 / 环境变量；都没有就读软件设置里那一份（你在「设置」里填过就不用再给我）
function keyFromSettings(): string {
  try {
    const home = process.env.APPDATA || ''
    if (!home) return ''
    const f = join(home, 'broken-arrow-log-assistant', 'settings.json')
    if (!existsSync(f)) return ''
    return String(JSON.parse(readFileSync(f, 'utf8')).gameKey || '')
  } catch {
    return ''
  }
}
const key = (arg('key') || process.env.BA_GAME_KEY || keyFromSettings()).trim()
const gameDir = arg('game-dir') || process.env.BA_GAME_DIR || 'D:/SteamLibrary/steamapps/common/broken_arrow'
const out = arg('out') || 'src/shared/game/data.json'

if (key.length !== 32) {
  console.error('要一个 32 位的密钥：--key <密钥> 或者环境变量 BA_GAME_KEY')
  process.exit(1)
}

console.log('读', gameDir, '…')
const t0 = Date.now()
const raw = extractRaw(gameDir, key, WANTED_COMBAT)
const data = tablesToData(rawToTables(raw))
const combat = buildCombat(raw)
const outCombat = arg('out-combat') || 'src/shared/game/combat.json'
writeFileSync(out, JSON.stringify(data) + '\n', 'utf8')
writeFileSync(outCombat, JSON.stringify(combat) + '\n', 'utf8')
const kb = (x: unknown): string => (JSON.stringify(x).length / 1024).toFixed(0) + ' KB'
console.log(
  `写好了 ${out}：${Object.keys(data.units).length} 个单位、${Object.keys(data.options).length} 套配装选项，${kb(data)}`
)
console.log(
  `写好了 ${outCombat}：${Object.keys(combat.weapons).length} 件武器、${Object.keys(combat.ammo).length} 种弹药、` +
    `${Object.keys(combat.armors).length} 种装甲，${kb(combat)}`
)
console.log(`${Date.now() - t0} ms，游戏版本戳 ${data.meta.stamp}`)
