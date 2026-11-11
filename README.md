# 龙区分类器（ba-dragon）

基于断箭（Broken Arrow）官方 GameLogs 日志和 [BATrace](https://dash.batrace.top/) 公开数据的本地对局复盘工具，
用来判断对局中每位玩家的水平（龙/区）。只读取日志和公开接口，不读写游戏内存，不注入进程，不影响反作弊。

> 本仓库是基于 Electron + TypeScript + React 的重写版，版本号从 1.0.0 开始。
> 旧版 4.0.x 在 [brokenarrow-log-maggot](https://github.com/AlexanderHYu/brokenarrow-log-maggot)。
> 新版使用相同的 `appId` 和数据目录，安装后会覆盖旧版，设置和对局档案保留。
> 由于版本号重新开始（1.0.0 < 4.0.3），4.0.x 的自动更新不会提示升级，首次需要手动安装。

## 功能

- **当前对局**：读取游戏日志，进入对局后自动查询名单里每个玩家的 ELO、胜率、K/D、常用单位和龙区分。
- **玩家查询**：按名字或 ID 搜索，查看龙区分、兵种构成、地图表现、最近对局和相遇记录。
- **单局复盘**：给每个玩家标记龙/区/泯并发称号，查看双方对比、玩家明细、单位数据和兵力曲线。
- **对局档案**：保存打过的对局，可以打开复盘或播放录像。
- **录像**：可选功能，自动录制每局并保存为 MP4，进度条上显示兵力曲线。
- **单位效能**：按本地对局统计各单位和配装的死亡率、伤害、花费效率。
- **配装计算器**：选择攻击方、目标和距离，计算命中、穿深、伤害、击杀时间和压制。
- **卡组工具**：备份、恢复、删除卡组，填写密钥后可以查看内容。
- **封禁监控**：提示你遇到过的玩家是否被封禁。

各功能的用法见 [使用说明](使用说明.md)。

## 下载

从 [Releases](https://github.com/AlexanderHYu/ba-dragon/releases/latest) 下载最新版：

| 文件 | 说明 |
| --- | --- |
| **`DragonClassifier-Setup-x.y.z.exe`（推荐）** | 安装版，支持一键更新：有新版本时顶部会提示，点「更新并重启」即可 |
| `DragonClassifier-Portable-x.y.z.exe` | 免安装版，无法自动替换自身，只提示有新版本，需要手动下载 |

首次启动时选择游戏目录（`broken_arrow`），之后进入对局会自动开始查询。
设置和对局档案保存在 `%APPDATA%\broken-arrow-log-assistant`，更换版本不会丢失。

## 游戏数据（可选）

复盘中的配装名称（「配装 A」→「M1A1 FEP Trophy」）和精确花费来自游戏自带的单位表。
软件已内置一份导出的单位表（`src/shared/game/data.json`），安装即可使用，但游戏更新后可能不是最新。
如需与游戏版本保持一致，可在「设置 → 游戏数据」中填写密钥并点击「读取」，从本机游戏文件中读取最新数据。
读取结果会保存下来，之后启动不会重复读取。密钥不随本仓库发布。
读取方式、准确性和重新导出方法见 [docs/game-db.md](docs/game-db.md)。

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

冒烟测试（`npm run smoke`）会实际启动软件，检查窗口渲染、IPC 和复盘计算是否正常。
可选环境变量：
`BA_SMOKE_FID=<对局ID>` 计算指定对局的复盘；`BA_SMOKE_SHOT=<路径>` 保存截图；
`BA_SMOKE_REC=1` 实际录制 6 秒并检查能否生成 MP4（需要 `vendor/ffmpeg`，屏幕不能处于休眠）；
`BA_SMOKE_EVAL='<一段表达式>'` 在界面中执行一段 JS 并返回结果（用于测量尺寸、点击元素），执行后再截一张图。

游戏大版本更新后，更新单位表：`npm run export-gamedata -- --key <密钥>`，然后提交 `src/shared/game/data.json` 和 `combat.json`。

## 结构

```
src/
  shared/   纯逻辑，不依赖 Electron：龙区分、称号、复盘、计算器、日志解析、IPC 类型
  main/     主进程：日志、BATrace、本地库、录像、游戏数据
  preload/  向界面暴露接口
  renderer/ React 界面，按功能分目录
```

完整的文档目录和代码地图见 [docs/README.md](docs/README.md)，开发约定和发版步骤见 [CLAUDE.md](CLAUDE.md)。

## 说明

龙区分和称号的算法见 [docs/algorithm.md](docs/algorithm.md)，配装计算器的公式见 [docs/game-db.md](docs/game-db.md)。

本项目最初 fork 自 Zola 的 [断箭蛆工具](https://github.com/Zawinzala/brokenarrow-log-maggot)（MIT）。
本仓库为重写版本：龙区分、称号、单局复盘、自动更新为本项目编写；
沿用自原项目的部分（录像、玩家追踪、卡组、日志解析规则）保留其版权声明，见 [LICENSE](LICENSE)。

玩家数据由 [BATrace](https://dash.batrace.top/) 提供（运营方已同意本工具使用其 API）。
录像使用 [FFmpeg](https://github.com/BtbN/FFmpeg-Builds)（GPL）。
