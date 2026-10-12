// ================= 自动更新 =================
// 安装版：electron-updater 读 GitHub Release 的 latest.yml，发现新版本只提示，
//   用户点「更新并重启」才下载，下好后自动安装并重新打开。
// 免安装版（portable）和开发环境：exe 没法自己替换自己，只查最新版本号，在顶部提示去下载页。
// 自动更新出错（网络、GitHub 抽风）也退回到提示下载页。
import { app, net } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { UpdateInfo } from '@shared/ipc'

const REPO = 'AlexanderHYu/ba-dragon'
const RELEASES_URL = 'https://github.com/' + REPO + '/releases/latest'
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR

/** a 比 b 新？只比前三段数字 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

export class Updater {
  private info: UpdateInfo | null = null
  private auto: AppUpdater | null = null

  constructor(private send: (info: UpdateInfo) => void) {}

  latest(): UpdateInfo | null {
    return this.info
  }

  private set(patch: Partial<UpdateInfo> & { version: string }): void {
    this.info = {
      current: app.getVersion(),
      url: RELEASES_URL,
      portable: IS_PORTABLE,
      mode: 'manual',
      status: 'available',
      ...(this.info || {}),
      ...patch
    }
    this.send(this.info)
  }

  /** 安装版才挂 electron-updater */
  init(injected?: AppUpdater): void {
    if (injected) this.auto = injected
    else if (!app.isPackaged || IS_PORTABLE || process.platform !== 'win32') return
    else try {
      // 运行时才 require：开发环境里没打包，不需要它
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      this.auto = autoUpdater
    } catch {
      this.auto = null
      return
    }
    const up = this.auto
    up.autoDownload = false
    up.autoInstallOnAppQuit = false
    up.logger = null
    let lastPct = -1
    up.on('update-available', (i) => {
      lastPct = -1
      this.set({ version: i.version, mode: 'auto', status: 'available', percent: null })
    })
    up.on('download-progress', (p) => {
      const pct = Math.floor(p.percent || 0)
      if (pct !== lastPct) {
        lastPct = pct
        this.set({ version: this.info?.version || app.getVersion(), status: 'downloading', percent: pct })
      }
    })
    up.on('update-downloaded', (i) => {
      this.set({ version: i.version, mode: 'auto', status: 'ready', percent: 100 })
      this.install()
    })
    up.on('error', () => {
      // 下载中途失败：改成提示去下载页（下一轮检查再试自动更新）
      if (this.info?.mode === 'auto' && this.info.status === 'downloading') void this.checkLatestRelease()
    })
  }

  async check(): Promise<void> {
    if (this.auto) {
      if (this.info?.mode === 'auto' && (this.info.status === 'downloading' || this.info.status === 'ready')) return
      try {
        await this.auto.checkForUpdates()
        return
      } catch {
        /* 退回到只提示 */
      }
    }
    await this.checkLatestRelease()
  }

  /** 只查版本号，不下载 */
  private async checkLatestRelease(): Promise<void> {
    try {
      const r = await net.fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!r.ok) return
      const j = (await r.json()) as { tag_name?: string; html_url?: string }
      const latest = String(j.tag_name || '').replace(/^v/i, '')
      if (latest && isNewerVersion(latest, app.getVersion())) {
        this.set({ version: latest, url: j.html_url || RELEASES_URL, mode: 'manual', status: 'available', percent: null })
      }
    } catch {
      /* 离线或 GitHub 不可用：下次再查 */
    }
  }

  /** 「更新并重启」：还没下载就先下载，下好后（update-downloaded）自动装 */
  install(): boolean {
    if (!this.auto || this.info?.mode !== 'auto') return false
    if (this.info.status === 'available') {
      this.set({ version: this.info.version, status: 'downloading', percent: 0 })
      this.auto.downloadUpdate().catch(() => {
        /* 失败走 error 事件 */
      })
      return true
    }
    if (this.info.status !== 'ready') return this.info.status === 'downloading'
    // 静默装完自动重开；before-quit 里会先停掉录像
    setImmediate(() => this.auto?.quitAndInstall(true, true))
    return true
  }
}
