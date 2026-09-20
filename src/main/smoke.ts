// 冒烟测试：BA_SMOKE=1 启动时跑一遍，确认窗口真的渲染出来了、IPC 通了，然后退出。
// 纯逻辑归 vitest 管，这里只管「能不能起来」。
import { writeFileSync } from 'node:fs'
import { app, type BrowserWindow } from 'electron'

/** 录 6 秒主屏，确认能出 MP4（要 vendor/ffmpeg；文件录完就删） */
async function recordTest(Svc: typeof import('./services/replays').ReplayService): Promise<Record<string, unknown>> {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { existsSync, mkdtempSync, readdirSync, statSync, rmSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'ba-rec-'))
  const cfg = {
    get: (k: string): unknown =>
      ({ replayEnabled: true, replayQuality: 720, replayFps: 30, replayBitrateMbps: 5, replayExposure: 0, replayAudio: 'off', replaySaveDir: dir, replayDisplayId: '', replayKeepDays: 0 })[k]
  }
  const logs: string[] = []
  const svc = new Svc(cfg as never, { get: () => undefined } as never, {
    status: (st: { error?: string }) => {
      if (st?.error) logs.push(Date.now() % 100000 + ' ERROR ' + st.error)
    },
    changed: () => undefined,
    log: (l: string) => logs.push(Date.now() % 100000 + ' ' + l)
  })
  // 先把编码器探测预热掉（首次要十几秒），不然 6 秒的测试还没开录就停了
  const { probeEncoders: warmEnc, probeOutputs: warmOut } = await import('./services/recorder')
  await Promise.all([warmEnc(), warmOut()])
  logs.push(Date.now() % 100000 + ' >> start')
  svc.startForMatch('smoketest', '冒烟')
  await new Promise((r) => setTimeout(r, 6000))
  logs.push(Date.now() % 100000 + ' >> stop')
  svc.stopForMatch('smoketest', '冒烟')
  // 合成要一会儿
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.mp4'))) break
  }
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp4')) : []
  const size = files.length ? statSync(join(dir, files[0])).size : 0
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 临时目录删不掉无所谓 */
  }
  return { ok: files.length > 0 && size > 10000, file: files[0] || null, size, log: logs.slice(-25) }
}

export async function run(win: BrowserWindow): Promise<void> {
  const out: Record<string, unknown> = {}
  try {
    out.title = win.getTitle()
    out.dom = await win.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('root')
      return {
        rendered: !!root && root.children.length > 0,
        brand: document.querySelector('.brand')?.textContent?.trim() || '',
        hasBridge: typeof window.BA === 'object',
        cards: document.querySelectorAll('.pcard').length,
        empty: document.querySelector('.empty')?.textContent?.trim() || ''
      }
    })()`)
    out.config = await win.webContents.executeJavaScript('window.BA.getConfig()')
    out.session = await win.webContents.executeJavaScript('window.BA.getSession().then(s => ({ listening: s.watcher.listening, file: !!s.watcher.file }))')
    // 复盘：用缓存里已有的一局（BA_SMOKE_FID），不发网络请求
    const fid = process.env.BA_SMOKE_FID
    if (fid) {
      out.report = await win.webContents.executeJavaScript(
        `window.BA.getMatchReport('${fid}').then(r => 'error' in r ? { error: r.error } : ({
          teams: r.teams.length, players: r.players.length, units: r.units.length,
          insights: r.insights.length, minutes: r.timeline.minutes, expected: r.teams[0].expected
        }))`
      )
    }
    out.archive = await win.webContents.executeJavaScript('window.BA.listArchive().then(l => l.length)')
    // 启动补读历史日志时不能开录（不然每次打开软件都会弹「没有录到画面」）
    await new Promise((r) => setTimeout(r, 4000))
    out.replay = await win.webContents.executeJavaScript(
      `Promise.all([window.BA.getReplayStatus(), window.BA.getReplayLogs()]).then(([st, logs]) => ({
        active: st.active, error: st.error || null, logs: logs.slice(-4)
      }))`
    )
    // 搜一个人并打开他的档案（BA_SMOKE_SEARCH 给名字）：验证搜索→详情这条链路
    if (process.env.BA_SMOKE_SEARCH) {
      out.search = await win.webContents.executeJavaScript(
        `window.BA.searchPlayers('${process.env.BA_SMOKE_SEARCH}').then(async (list) => {
          if (!list.length) return { found: 0 }
          const card = await window.BA.getPlayerCard(list[0].id, { name: list[0].name })
          return {
            found: list.length, id: list[0].id, name: card.name,
            infoState: card.infoState, dragonState: card.dragonState,
            elo: card.info && card.info.elo, score: card.dragon && card.dragon.value,
            kd: card.dragon && card.dragon.summary.kdAgg, error: card.error || null
          }
        })`
      )
    }
    // 截图（BA_SMOKE_SHOT 给路径）：主界面一张，复盘页一张
    const shot = process.env.BA_SMOKE_SHOT
    if (shot) {
      writeFileSync(shot.replace(/\.png$/, '') + '-main.png', (await win.webContents.capturePage()).toPNG())
      // 点开第一条录像，看播放器和兵力曲线渲染出来没有
      const opened = await win.webContents.executeJavaScript(`(() => {
        const row = document.querySelector('.replay-row')
        if (!row) return false
        row.click()
        return true
      })()`)
      if (opened) {
        await new Promise((r) => setTimeout(r, 2500))
        writeFileSync(shot.replace(/\.png$/, '') + '-player.png', (await win.webContents.capturePage()).toPNG())
        out.player = await win.webContents.executeJavaScript(`(() => {
          const v = document.querySelector('video')
          return { video: !!v, src: v && v.getAttribute('src'), curves: document.querySelectorAll('.bplayer-bar path, .bplayer-bar polyline').length }
        })()`)
      }
      // 亮色配色也来一张
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light'`)
      await new Promise((r) => setTimeout(r, 300))
      writeFileSync(shot.replace(/\.png$/, '') + '-light.png', (await win.webContents.capturePage()).toPNG())
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'dark'`)
      if (fid) {
        await win.webContents.executeJavaScript(`window.__openReport && window.__openReport('${fid}')`)
        await new Promise((r) => setTimeout(r, 1500))
        writeFileSync(shot.replace(/\.png$/, '') + '-report.png', (await win.webContents.capturePage()).toPNG())
      }
      out.shots = true
    }
  } catch (e) {
    out.error = String((e as Error)?.message || e)
  }
  // 录像真机自测：开录几秒再停，看合成出来的 MP4 在不在
  if (process.env.BA_SMOKE_REC) {
    try {
      const { ReplayService } = await import('./services/replays')
      out.rec = await recordTest(ReplayService)
    } catch (e) {
      out.rec = { error: String((e as Error)?.message || e) }
    }
  }

  const dom = out.dom as { rendered?: boolean; hasBridge?: boolean } | undefined
  const rep = out.report as { players?: number; error?: string } | undefined
  const rec = out.rec as { ok?: boolean } | undefined
  const ok =
    !!dom?.rendered && !!dom?.hasBridge && !out.error && (!rep || (rep.players ?? 0) > 0) && (!rec || !!rec.ok)
  const line = 'SMOKE ' + JSON.stringify({ ok, ...out })
  console.log(line)
  // 打包后的 exe 是 GUI 程序，标准输出拿不到，所以也写一份文件（验收打包产物用）
  if (process.env.BA_SMOKE_OUT) {
    try {
      writeFileSync(process.env.BA_SMOKE_OUT, line, 'utf8')
    } catch {
      /* 写不了就算了 */
    }
  }
  app.exit(ok ? 0 : 1)
}
