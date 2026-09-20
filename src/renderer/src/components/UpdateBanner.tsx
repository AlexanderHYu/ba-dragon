// 新版本横幅：安装版显示下载进度和「重启更新」，免安装版提示去下载页。
// 关掉后同一版本、同一阶段不再弹（下载好了会再提示一次）。
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
    text = '✅ 新版本 ' + v + ' 已经下载好了。点「重启更新」马上装好并重新打开；不点的话，下次关软件时自动装。'
  } else if (info.mode === 'auto') {
    text = '⬇ 发现新版本 ' + v + cur + '，正在后台下载… ' + (info.percent || 0) + '%'
  } else if (info.portable) {
    text = '🆕 有新版本 ' + v + cur + '。免安装版不能自动更新，下载新的 exe 换掉旧的即可；推荐改用安装版。设置和档案都会保留。'
  } else {
    text = '🆕 有新版本 ' + v + cur + '。下载新的安装包运行覆盖安装即可，设置和档案都会保留。'
  }

  return (
    <div className="update-banner">
      <span className="grow">{installing ? '正在关闭并安装新版本…' : text}</span>
      {info.mode === 'auto' && info.status === 'ready' && (
        <button
          className="primary"
          onClick={() => {
            setInstalling(true)
            void window.BA.installUpdate()
          }}
        >
          重启更新
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
