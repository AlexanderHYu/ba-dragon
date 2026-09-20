# 🐉 龙区分类器（ba-dragon）

基于断箭（Broken Arrow）官方 GameLogs 日志和 [BATrace](https://app.batrace.top/) 公开数据的本地对局复盘工具：
谁是龙、谁是区，一眼看清。只读日志与公开接口，不碰内存、不注入进程、不影响反作弊。

> **重写中。** 这是 5.0 的仓库，从零搭的 Electron + TypeScript + React。
> 正在用的 4.0.x 在 [brokenarrow-log-maggot](https://github.com/AlexanderHYu/brokenarrow-log-maggot)，
> 5.0 发布后会用同一个 `appId` 覆盖安装，设置和对局档案都保留。

## 进度

- [x] 脚手架：electron-vite + React + TypeScript + vitest
- [x] 龙区分、称号、单局复盘、日志解析搬到 `src/shared`，和 4.0.3 在 1199 局真实数据上逐字段对拍一致
- [x] 主进程骨架：配置、本地 SQLite、BATrace 客户端、日志监听
- [x] 查询合并：进对局分两轮把名单里每个人算好（档案 → 龙区分），结果存本地库
- [x] 界面：对局名单、玩家详情、单局复盘页、对局档案
- [x] 卡组备份还原、调查羁绊、封禁监控（启动查一次 + 手动刷新）
- [x] 行车记录仪（录像）
- [x] 老数据迁移：4.0.x 的对局档案、玩家库、ELO 快照搬进本地库
- [x] 自动更新、打包、CI
- [ ] 真机跑一局验收（录像要在玩游戏时才能验）
- [ ] 发 5.0.0（新旧仓库各发一次，让 4.0.3 一步升上来）

## 开发

```bash
npm install
npm run dev        # 开发模式，界面热重载
npm test           # 纯逻辑测试（含和 4.0.x 的对拍，缺老仓库会自动跳过）
npm run typecheck
npm run dist       # 打包 Windows 安装版和免安装版
```

`npm test` 里的对拍需要本机有老仓库和它的 `backtest-data/`，路径用 `BA_LEGACY` 指定，默认
`H:/github/brokenarrow-log-maggot`。CI 上没有老仓库，这些测试会自动跳过。

冒烟测试（`npm run smoke`）会真的把软件起起来，确认窗口渲染、IPC 通、复盘算得出来。
几个可选开关：`BA_SMOKE_FID=<对局ID>` 顺带算一次复盘、`BA_SMOKE_SHOT=<路径>` 截图、
`BA_SMOKE_REC=1` 真机录 6 秒看能不能出 MP4（需要 `vendor/ffmpeg`，且屏幕不能处于休眠）。

## 结构

```
src/
  shared/   纯逻辑，不碰 Electron，可单测：龙区分、称号、复盘、日志解析、IPC 契约与类型
  main/     主进程：services（日志、BATrace、存储、录像）+ ipc（按域注册）
  preload/  contextBridge
  renderer/ React 界面，按功能分目录
```

## 说明

龙区分和称号的算法、模型参数怎么来的，见 `docs/`。

本项目最初 fork 自 Zola 的 [断箭蛆工具](https://github.com/Zawinzala/brokenarrow-log-maggot)（MIT），
5.0 是重写版本：龙区分、称号、单局复盘、自动更新是我们自己写的；
从原项目沿用过来的部分（录像、玩家追踪、卡组、日志解析规则）保留其版权声明，见 [LICENSE](LICENSE)。

玩家数据由 [BATrace](https://app.batrace.top/) 提供（运营方已同意本工具使用其 API）。
录像使用 [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）。
