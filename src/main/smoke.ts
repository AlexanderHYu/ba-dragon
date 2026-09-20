// 冒烟测试：BA_SMOKE=1 启动时跑一遍，确认窗口真的渲染出来了、IPC 通了，然后退出。
// 纯逻辑归 vitest 管，这里只管「能不能起来」。
import { app, type BrowserWindow } from 'electron'

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
  } catch (e) {
    out.error = String((e as Error)?.message || e)
  }
  const dom = out.dom as { rendered?: boolean; hasBridge?: boolean } | undefined
  const rep = out.report as { players?: number; error?: string } | undefined
  const ok = !!dom?.rendered && !!dom?.hasBridge && !out.error && (!rep || (rep.players ?? 0) > 0)
  console.log('SMOKE ' + JSON.stringify({ ok, ...out }))
  app.exit(ok ? 0 : 1)
}
