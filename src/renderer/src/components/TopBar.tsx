// 顶栏：版本号、日志目录状态、BATrace 连接状态、设置入口。
import { useEffect } from 'react'
import { useStore } from '../store'

export default function TopBar(): React.JSX.Element {
  const { status, setStatus, page, setPage } = useStore()

  useEffect(() => {
    const pull = (): void => void window.BA.getStatus().then(setStatus)
    pull()
    const t = setInterval(pull, 5000)
    return () => clearInterval(t)
  }, [setStatus])

  const api = status?.api
  const apiCls = api?.ok == null ? 'wait' : api.ok ? 'ok' : 'bad'
  const apiText = api?.ok == null ? 'BATrace 待请求' : api.ok ? 'BATrace 正常' : 'BATrace ' + (api.message || '异常')
  const logCls = status?.watching ? 'ok' : status?.logFound ? 'wait' : 'bad'
  const logText = status?.watching ? '日志监听中' : status?.logFound ? '找到目录，等日志' : '没找到游戏目录'

  return (
    <div className="topbar">
      <div className="brand">
        <span className="dragon">🐉</span> 龙区分类器
        <span className="ver">v{status?.version || '…'}</span>
      </div>
      <span className={'status ' + logCls} title={status?.logDir || ''}>
        <i />
        {logText}
      </span>
      <span className={'status ' + apiCls} title={api?.at ? new Date(api.at).toLocaleTimeString('zh-CN') + ' · 本次启动发了 ' + api.requests + ' 个请求' : ''}>
        <i />
        {apiText}
      </span>
      <span className="grow" />
      <button className={page.name === 'home' ? 'primary' : ''} onClick={() => setPage({ name: 'home' })}>
        🏠 主界面
      </button>
      <button className={page.name === 'settings' ? 'primary' : ''} onClick={() => setPage({ name: 'settings' })}>
        ⚙ 设置
      </button>
    </div>
  )
}
