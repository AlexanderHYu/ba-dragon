# 🐉 龙区分类器（ba-dragon）

基于断箭（Broken Arrow）官方 GameLogs 日志和 [BATrace](https://app.batrace.top/) 公开数据的本地对局复盘工具：
谁是龙、谁是区，一眼看清。只读日志与公开接口，不碰内存、不注入进程、不影响反作弊。

> **重写版。** 这是重写后的仓库，从零搭的 Electron + TypeScript + React，版本号从 1.0.0 重新起算。
> 正在用的 4.0.x 在 [brokenarrow-log-maggot](https://github.com/AlexanderHYu/brokenarrow-log-maggot)，
> 沿用同一个 `appId` 和数据目录，装上就会覆盖旧版，设置和对局档案都保留。
> 注意：版本号重新起算（1.0.0 < 4.0.3），所以 4.0.x 的自动更新**不会**提示升级，头一次要手动装。

## 下载

去 [Releases](https://github.com/AlexanderHYu/ba-dragon/releases/latest) 拿最新版：

| 选哪个 | 说明 |
| --- | --- |
| **`DragonClassifier-Setup-x.y.z.exe`（推荐）** | 安装版。**能自动更新**：以后有新版本会在后台下好，提示你重启一下就装完了 |
| `DragonClassifier-Portable-x.y.z.exe` | 免安装版。exe 没法自己替换自己，只会提示有新版本，要手动下 |

装完直接开，第一次会让你选游戏目录（`broken_arrow`），之后进游戏就自动干活。
设置和对局档案在 `%APPDATA%\broken-arrow-log-assistant`，换版本不会丢。

## 游戏数据（可选）

复盘里的配装真名（「配装 A」→「M1A1 FEP Trophy」）和精确花费，来自游戏自带的一张单位表。
软件里**已经带了一份导出好的**（`src/shared/game/data.json`），装上就能用，只是游戏更新后可能略旧。
要一直跟着游戏走，可以在「设置 → 游戏数据」里填上密钥，点一下「读取」，从自己机器上的游戏文件里解一份最新的
（解一次存一次，不会每次开软件都解）。**密钥不随本仓库发布。**
怎么读的、准不准、怎么重新导出，见 [docs/game-db.md](docs/game-db.md)。

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
`BA_SMOKE_REC=1` 真机录 6 秒看能不能出 MP4（需要 `vendor/ffmpeg`，且屏幕不能处于休眠）、
`BA_SMOKE_EVAL='<一段表达式>'` 在界面里跑一段 JS 把结果带回来（量尺寸、点东西用），跑完再截一张。

游戏单位表更新（游戏大版本之后）：`npm run export-gamedata -- --key <密钥>`，然后提交 `src/shared/game/data.json`。

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
本仓库是重写版本：龙区分、称号、单局复盘、自动更新是我们自己写的；
从原项目沿用过来的部分（录像、玩家追踪、卡组、日志解析规则）保留其版权声明，见 [LICENSE](LICENSE)。

玩家数据由 [BATrace](https://app.batrace.top/) 提供（运营方已同意本工具使用其 API）。
录像使用 [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）。
