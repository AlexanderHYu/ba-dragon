# 龙蛆分类器（ba-dragon）开发约定

项目结构看 [docs/README.md](docs/README.md)。

## 常用命令

```bash
npm run dev
npm run typecheck
npm test
npm run smoke
npm run export-gamedata -- --key <密钥>
```

## 改代码

- 纯逻辑放 `src/shared`，不要依赖 Electron。Electron 和文件操作放 `src/main/services`。
- 新增 IPC 要改三处：`src/shared/ipc.ts`、`src/main/ipc/index.ts`、`src/preload/index.ts`。
- 不要对现有文件运行 `prettier --write`：现有代码不是 Prettier 默认格式，会产生整文件的改动。
- `src/shared/game/data.json` 和 `combat.json` 是生成文件，不要手改。
- 计算器的公式要有依据：游戏数据或机器码。依据和修正记录写进 `docs/game-db.md`。
- 改了界面和行为，同步更新 `使用说明.md`。

## 龙蛆分和称号

- 两套分开：龙蛆分衡量玩家在同分段、同兵种构成里的强弱；称号只看这一局的实际作用，不考虑 ELO。
- 改了评分规则要提高 `src/main/services/matchImport.ts` 的 `SCORE_VERSION`，让已入库的对局重新计算。
- K/D 和摧毁贡献按兵种加权是有意的取舍。不要用加权后的 K/D 重新拟合各角色的基准，否则会抵消加权效果。
- 称号不加权，因为说明里引用的是原始数字。每人最多 2 个称号，出现率不要调得太低。

## 界面和文档文字

- 面向断箭玩家，用直白的说法。标签用短语，说明一句话讲清楚。
- 不用比喻和口语化的花样，比如「进账」「带走」「亮起来」。
- 保留专有词：龙/蛆/泯、龙蛆分、ELO、K/D、BATrace。界面上一律写「蛆」，不写「区」（以前写「区」，有人看不懂是哪个字）；代码里的 `qu` 和 `区` 注释不用改。
- 称号名字（大腿、背锅侠等）是社区梗，不要改。

## BATrace

- 程序访问地址是 `https://bot.batrace.top`，网页链接用 `https://dash.batrace.top`。
- 每个请求都要带客户端标识。软件用 `X-Client: ba-dragon-app`，我们自己的脚本和手动测试用 `X-Client: ba-dragon-collector`。这个值不要带版本号，版本号放在 User-Agent 里。
- 请求严格串行。软件默认间隔 1.2 秒（`apiDelayMs`）。
- 批量采集时间隔至少 2 秒，不要并行。开始前先说明请求数量，等用户同意，结束后报告实际数量。
- 带 JSON 的 404 表示没有数据，不算连接异常。Cloudflare 的 403 表示被防火墙拦截，不要自动重试。
- 2026-10 起 `/api/match` 曾被 Cloudflare 拦截，复盘页依赖它。遇到相关问题先实测当前状态。

## 游戏更新

1. 从 Steam 公告（appid 1604270）查改动。
2. 导出新数据，和旧的 `data.json`、`combat.json` 逐项比较。
3. 对照公告核对，并列出对不上的地方和公告没提的改动。
4. 运行测试和冒烟测试，确认计算器读到新数据。

解不开数据时，先用密钥解一个新保存的卡组（`.dek`）。卡组能解开，说明密钥没问题，要查数据格式是否变了。

**游戏密钥不进仓库，也不写进任何文件。** 通过环境变量 `BA_GAME_KEY` 或软件设置传入。

## 发版

只有用户要求时才发版，推送前先确认已经运行过 `npm run typecheck`、`npm test` 和 `npm run smoke`。

1. 功能在分支上开发，合并到 `main`。
2. 只改 `package.json` 的版本号，提交信息写 `vX.Y.Z：改动摘要`。
3. 打标签 `vX.Y.Z`，推送 `main` 和标签。CI 会构建并创建 Release。
4. CI 成功后用 `gh release edit` 写标题和说明，确认 Release 里有两个 exe、blockmap 和 `latest.yml`。

提交信息用中文。
