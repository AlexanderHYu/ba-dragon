// 把 SVG 渲染成透明底 PNG（借 Electron 的 Chromium，不另装依赖）。用法见 scripts/make-icon.py 开头。
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [svgPath, outPath, sizeArg] = process.argv.slice(-3)
const size = Number(sizeArg) || 1024
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  const svg = fs.readFileSync(svgPath, 'utf8')
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="width:${size}px;height:${size}px;display:block"></body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  fs.writeFileSync(outPath, img.resize({ width: size, height: size }).toPNG())
  app.quit()
})
