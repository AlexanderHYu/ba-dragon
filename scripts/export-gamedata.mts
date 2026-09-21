// 把游戏自带的单位表导出成软件自带的那一份（src/shared/game/data.json）。
//
//   npx vite-node scripts/export-gamedata.mts -- --key <32位密钥> [--game-dir <游戏目录>]
//   或者把密钥放进环境变量 BA_GAME_KEY
//
// 游戏每次大更新之后跑一遍、提交，没有密钥的人也就跟着有了新数据。
import { writeFileSync } from 'node:fs'
import { extractTables, tablesToData } from '../src/main/services/gameDb'

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}

const key = (arg('key') || process.env.BA_GAME_KEY || '').trim()
const gameDir = arg('game-dir') || process.env.BA_GAME_DIR || 'D:/SteamLibrary/steamapps/common/broken_arrow'
const out = arg('out') || 'src/shared/game/data.json'

if (key.length !== 32) {
  console.error('要一个 32 位的密钥：--key <密钥> 或者环境变量 BA_GAME_KEY')
  process.exit(1)
}

console.log('读', gameDir, '…')
const t0 = Date.now()
const tables = extractTables(gameDir, key)
const data = tablesToData(tables)
writeFileSync(out, JSON.stringify(data) + '\n', 'utf8')
console.log(
  `写好了 ${out}：${Object.keys(data.units).length} 个单位、${Object.keys(data.options).length} 套配装选项，` +
    `${Date.now() - t0} ms，${(JSON.stringify(data).length / 1024).toFixed(0)} KB`
)
console.log('游戏版本戳', data.meta.stamp)
