# 文档索引

项目的文档目录和代码地图。玩家使用方法看 [使用说明](../使用说明.md)，开发约定和发版步骤看 [CLAUDE.md](../CLAUDE.md)。

## 文档

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [README](../README.md) | 项目简介、功能、下载、开发命令 | 现行 |
| [使用说明](../使用说明.md) | 各功能怎么用 | 现行 |
| [algorithm.md](algorithm.md) | 龙区分和单局称号的算法 | 现行 |
| [game-db.md](game-db.md) | 游戏数据解包、配装计算器的公式和依据 | 现行 |
| [rating-design.md](rating-design.md) | 龙区分和称号的设计取舍、拟合数据 | 历史记录：4.0.x 时期写的，代码路径和命令指向旧仓库 |
| [rewrite-plan.md](rewrite-plan.md) | 从 4.0.x 重写的方案 | 历史记录，不代表现状 |

版本变化记录在 [GitHub Releases](https://github.com/AlexanderHYu/ba-dragon/releases)。

## 技术栈

Electron + TypeScript + React，用 electron-vite 构建、Vitest 测试、electron-builder 打包。本地库是 SQLite（node-sqlite3-wasm），录像用 FFmpeg。

## 目录

```
src/
  main/       主进程：窗口、服务、IPC
  preload/    把主进程的接口暴露给界面（window.BA）
  renderer/   React 界面
  shared/     纯逻辑和类型，不依赖 Electron，主进程和界面共用
scripts/      导出游戏数据、下载 FFmpeg、拟合模型、冒烟测试
tools/        il2cpp-peek.py：查看游戏方法的机器码，用来核对公式
native/       wasapi-loopback.cs：采集系统声音和麦克风
docs/         文档
vendor/       FFmpeg（下载得到，不进仓库）
```

## 主进程 `src/main`

- `index.ts`：创建窗口和各服务，把日志事件接到查询和录像，设置定时任务。
- `ipc/index.ts`：注册界面调用的 IPC 通道。
- `smoke.ts`：冒烟测试。

### 服务 `src/main/services`

| 分类 | 文件 | 职责 |
| --- | --- | --- |
| 基础 | `config.ts` | 读写 `settings.json` |
| | `db.ts` | 本地 SQLite 库 |
| | `migrate.ts` | 把 4.0.x 的 JSON 数据迁入本地库 |
| | `updater.ts` | 检查和安装更新 |
| 日志 | `logWatcher.ts` | 跟踪最新的游戏日志，只读新增内容 |
| BATrace | `batrace.ts` | 接口客户端：串行请求、缓存、连接状态 |
| 玩家 | `players.ts` | 玩家卡片（档案 + 龙区分） |
| | `query.ts` | 进对局后分两轮查询名单 |
| | `tracker.ts` | 相遇记录、调查羁绊 |
| | `bans.ts` | 封禁监控 |
| 对局 | `matchImport.ts` | 按对局 ID 拉取单局数据并入库 |
| | `matchSync.ts` | 每小时同步本机账号的最近对局 |
| | `analytics.ts` | 单位效能统计 |
| 录像 | `replays.ts` | 决定何时开始、停止录制，保存和命名文件 |
| | `recorder.ts` | FFmpeg 采集、硬件编码、合成 MP4 |
| | `audioLoopback.ts` | 系统声音和麦克风采集 |
| | `displayColor.ts` | 检测显示器 HDR 状态 |
| | `replayLocal.ts` | 管理本地录像文件和文件名编码 |
| 游戏数据 | `unityfs.ts` | 按需读取 `data.unity3d` |
| | `gameDb.ts` | 解密数据库，选择本地或自带数据 |
| | `combatBuild.ts` | 生成计算器用的 `combat.json` |
| | `decks.ts` | 卡组备份、恢复和解密 |

## 共享逻辑 `src/shared`

| 位置 | 职责 |
| --- | --- |
| `ipc.ts` | IPC 通道和数据类型，主进程和界面共用 |
| `log/parser.ts` | 把日志文本解析成对局事件 |
| `log/host.ts` | 从日志推测房主 |
| `dragon/score.ts` | 龙区分和单局龙/区/泯 |
| `dragon/titles.ts` | 单局称号 |
| `dragon/roles.ts` | 玩家的兵种构成 |
| `dragon/model.json` | 拟合得到的模型参数 |
| `match/report.ts` | 整理单局复盘数据 |
| `combat/model.ts` | 配装计算器：命中、穿深、伤害、压制模拟 |
| `game/data.json` | 自带的单位和配装数据（导出生成） |
| `game/combat.json` | 自带的武器、弹药、装甲数据（导出生成） |
| `game/combat.ts` | `combat.json` 数组字段的含义 |
| `types/batrace.ts` | BATrace 返回数据的类型 |
| `zip.ts` | 卡组备份用的 ZIP 读写 |

## 界面 `src/renderer/src`

`App.tsx` 按 `store.ts` 里的当前页面切换内容。公共组件在 `components/`，页面在 `features/`：

| 目录 | 内容 |
| --- | --- |
| `home/` | 主界面，组合下面的卡片 |
| `current/` | 当前房间和对局名单 |
| `players/` | 玩家搜索和详情 |
| `archive/` | 对局档案 |
| `report/` | 单局复盘页 |
| `replay/` | 行车记录仪和播放器 |
| `decks/` | 卡组工具、封禁监控 |
| `stats/` | 单位效能 |
| `calc/` | 配装计算器 |
| `settings/` | 设置 |

## 主要流程

**进入对局**

```
游戏日志 → logWatcher → log/parser → query → players → batrace → 本地库 → 界面名单
                                  └→ replays → recorder（开始录制）
```

**打开复盘**

```
界面 → IPC match:report → matchImport → batrace /api/match → 本地库
     → dragon/score + titles + match/report → 复盘页
```

**配装计算器**

```
data.unity3d → unityfs + gameDb + combatBuild → combat.json → combat/model → 计算器页面
```

计算全部在本地完成，不请求 BATrace。

## 本地数据

数据目录是 `%APPDATA%\broken-arrow-log-assistant`：

- `settings.json`：设置，和 4.0.x 共用同一个文件。
- `dragon.sqlite`：本地库，表有 `meta`、`match`、`match_player`、`match_unit`、`player`、`encounter`、`elo_snapshot`、`card`、`api_cache`。
- `replays/`：默认录像目录，可以在设置里修改。

## 脚本和工具

| 文件 | 用途 |
| --- | --- |
| `scripts/export-gamedata.mts` | 导出 `data.json` 和 `combat.json`，需要密钥 |
| `scripts/fetch-ffmpeg.mjs` | 下载 FFmpeg 到 `vendor/ffmpeg` 并校验 |
| `scripts/smoke.mjs` | 启动冒烟测试 |
| `scripts/fit-outcome.ts` | 重新拟合百分位表和卡尔曼参数 |
| `scripts/fit-trade.ts` | 计算兵种交换加权系数 |
| `scripts/fit-titles.ts` | 校准称号阈值 |
| `tools/il2cpp-peek.py` | 查看游戏方法的机器码 |
| `native/wasapi-loopback.cs` | 声音采集程序的源码 |

拟合脚本使用旧仓库 `brokenarrow-log-maggot` 的 `backtest-data/`，采集脚本也在旧仓库（`scripts/collect-dragon-data.js`）。

## 测试

| 文件 | 覆盖内容 |
| --- | --- |
| `shared/combat/model.test.ts` | 计算器公式和压制模拟 |
| `shared/dragon/parity.test.ts` | 和 4.0.x 对比结果，缺旧仓库时跳过 |
| `shared/dragon/trade.test.ts` | 兵种交换加权 |
| `shared/log/parser.test.ts`、`host.test.ts` | 日志解析、房主推测 |
| `shared/match/loadout.test.ts`、`price.test.ts` | 配装名称和价格 |
| `main/services/gameDb.test.ts` | 游戏数据读取 |
| `main/services/updater.test.ts` | 更新流程 |
