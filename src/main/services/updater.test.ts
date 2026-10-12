import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import type { UpdateInfo } from '@shared/ipc'

vi.mock('electron', () => ({ app: { getVersion: () => '1.1.2', isPackaged: false }, net: {} }))
const { Updater } = await import('./updater')

function fakeUpdater() {
  const up = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: undefined as unknown,
    checkForUpdates: vi.fn(async () => {
      up.emit('update-available', { version: '1.1.3' })
    }),
    downloadUpdate: vi.fn(async () => {
      up.emit('download-progress', { percent: 50 })
      up.emit('update-downloaded', { version: '1.1.3' })
    }),
    quitAndInstall: vi.fn()
  })
  return up
}

describe('Updater：手动「更新并重启」', () => {
  it('发现新版本只提示，点了才下载，下完自动安装', async () => {
    const sent: UpdateInfo[] = []
    const up = fakeUpdater()
    const u = new Updater((i) => sent.push({ ...i }))
    u.init(up as unknown as AppUpdater)
    expect(up.autoDownload).toBe(false)
    expect(up.autoInstallOnAppQuit).toBe(false)

    await u.check()
    expect(u.latest()).toMatchObject({ version: '1.1.3', mode: 'auto', status: 'available' })
    expect(up.downloadUpdate).not.toHaveBeenCalled()

    expect(u.install()).toBe(true)
    await new Promise((r) => setImmediate(r))
    expect(up.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(sent.map((i) => i.status)).toEqual(['available', 'downloading', 'downloading', 'ready'])
    await new Promise((r) => setImmediate(r))
    expect(up.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('下载中再点不会重复下载', async () => {
    const up = fakeUpdater()
    up.downloadUpdate.mockImplementation(async () => {})
    const u = new Updater(() => {})
    u.init(up as unknown as AppUpdater)
    await u.check()
    u.install()
    expect(u.install()).toBe(true)
    expect(up.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(up.quitAndInstall).not.toHaveBeenCalled()
  })
})
