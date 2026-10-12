// 新版本横幅：安装版点「更新并重启」才下载，下完自动安装重开；免安装版提示去下载页。
// 关掉后同一版本、同一阶段不再弹。
import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/ipc'

export default function UpdateBanner(): React.JSX.Element | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    void window.BA.getUpdateInfo().then(setInfo)
    return window.BA.on('update:available', setInfo)
  }, [])

  if (!info) return null
  const stage = info.version + ':' + info.status
  if (dismissed === stage) return null

  const v = 'v' + info.version
  const cur = '（当前 v' + info.current + '）'
  let text: string
  if (info.mode === 'auto' && info.status === 'ready') {
    text = '正在关闭并安装新版本 ' + v + '…'
  } else if (info.mode === 'auto' && info.status === 'downloading') {
    text = '⬇ 正在下载新版本 ' + v + '… ' + (info.percent || 0) + '%，下载完成后自动重启'
  } else if (info.mode === 'auto') {
    text = '🆕 新版本 ' + v + cur + '。设置和档案会保留。'
  } else if (info.portable) {
    text = '🆕 新版本 ' + v + cur + '。免安装版不支持自动更新，请下载新 exe 替换旧文件（推荐使用安装版）。设置和档案会保留。'
  } else {
    text = '🆕 新版本 ' + v + cur + '。请下载安装包覆盖安装，设置和档案会保留。'
  }

  return (
    <div className="update-banner">
      <span className="grow">{text}</span>
      {info.mode === 'auto' && info.status === 'available' && !installing && (
        <button
          className="primary"
          onClick={() => {
            setInstalling(true)
            void window.BA.installUpdate()
          }}
        >
          更新并重启
        </button>
      )}
      {info.mode !== 'auto' && (
        <button className="primary" onClick={() => window.BA.openExternal(info.url)}>
          打开下载页
        </button>
      )}
      <button onClick={() => setDismissed(stage)}>✕</button>
    </div>
  )
}
