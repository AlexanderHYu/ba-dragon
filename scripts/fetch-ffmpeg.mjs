// 下载录像用的 FFmpeg（BtbN 的 Windows GPL 构建，ffmpeg.org 官方下载页推荐）到 vendor/ffmpeg/
// 用法：node scripts/fetch-ffmpeg.mjs（已存在则跳过；加 --force 重新下载）
// 校验：同一个 release 里的 checksums.sha256，对不上直接失败
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const ASSET = 'ffmpeg-n8.1-latest-win64-gpl-8.1.zip'
const BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/'
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'ffmpeg')
const force = process.argv.includes('--force')

// dest 为空 → 把正文当文本返回；否则下载到 dest
function get(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'fetch-ffmpeg' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return get(new URL(res.headers.location, url).toString(), dest).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error('HTTP ' + res.statusCode + ' ' + url))
        }
        if (!dest) {
          let s = ''
          res.setEncoding('utf8')
          res.on('data', (d) => {
            s += d
          })
          res.on('end', () => resolve(s))
          return
        }
        const out = createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve(dest)))
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

try {
  const exe = join(OUT_DIR, 'ffmpeg.exe')
  if (existsSync(exe) && !force) {
    console.log('已存在，跳过：' + exe)
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'fetch-ffmpeg-'))
    try {
      console.log('读取校验值…')
      const sums = await get(BASE + 'checksums.sha256')
      const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(ASSET))
      if (!line) throw new Error('checksums.sha256 里没有 ' + ASSET)
      const expected = line.trim().split(/\s+/)[0].toLowerCase()
      console.log('下载 ' + ASSET + '（约 180MB）…')
      const zip = await get(BASE + ASSET, join(tmp, ASSET))
      const actual = await sha256(zip)
      if (actual !== expected) throw new Error('SHA256 不匹配：期望 ' + expected + '，实际 ' + actual)
      console.log('校验通过，解压…')
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Expand-Archive -LiteralPath $env:FF_ZIP -DestinationPath $env:FF_DIR -Force'
        ],
        { stdio: 'inherit', env: { ...process.env, FF_ZIP: zip, FF_DIR: join(tmp, 'x') } }
      )
      const root = readdirSync(join(tmp, 'x'))
        .map((d) => join(tmp, 'x', d))
        .find((d) => existsSync(join(d, 'bin', 'ffmpeg.exe')))
      if (!root) throw new Error('压缩包里没有 bin/ffmpeg.exe')
      mkdirSync(OUT_DIR, { recursive: true })
      copyFileSync(join(root, 'bin', 'ffmpeg.exe'), exe)
      copyFileSync(join(root, 'LICENSE.txt'), join(OUT_DIR, 'LICENSE.txt'))
      console.log('完成：' + exe)
    } finally {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* 临时目录删不掉无所谓 */
      }
    }
  }
} catch (e) {
  console.error('fetch-ffmpeg 失败：' + e.message)
  process.exit(1)
}
