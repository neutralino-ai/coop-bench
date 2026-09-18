# Coop Bench · 合作桌游环境

**Windows / macOS 桌面客户端、通用游戏 API、10 款可运行环境、可重放训练轨迹。** 0.5.0 新增设置面板、账户密码登录与密码设置，默认使用本地打包界面连接远程 API，不在电脑上启动游戏服务器；`--local` 保留原单机环境。Electron 复用同一套界面，Windows、macOS Intel / Apple Silicon 的原生 CI 与打包后应用验收均已通过；安装器尚未签名公证。[远程客户端设计与使用](docs/desktop-client.md)。从已选定的 13 款中核查规则与组件；Just One、So Clover!、Codenames: Duet 因未取得足够完整的原版组件数据而排除。10 款不等于全部战役和扩展，每款覆盖范围见下表。

仓库：[neutralino-ai/coop-bench](https://github.com/neutralino-ai/coop-bench)。这是可独立克隆的项目，无需相邻的其他源码目录；Windows / macOS 开发步骤见[新电脑开发指南](docs/development.md)。

**客户端主界面是人类 Rollout 审计台**：可选择游戏、关卡和人数创建对局，为各个 Agent 分别复制座位配置。Agent 通过 API 玩，服务器自动把讨论、动作、精确决策输入、各玩家视图和终局写入 SQLite；人类通过时间线、棋盘、玩家视角和审阅笔记检查记录。见 [Rollout 存储与审计前端](docs/rollout-audit.md)。

**比赛中的模型 messages**：运行器逐次记录实际模型请求、响应、reasoning、工具调用和结果，用各自 seat token 上传私有消息流；人类按玩家审阅，队友不可读取。真实 reasoning 文本、摘要、token 计数和不可读的加密字段分别标注。早期 Take Time 三子智能体演示只有工具日志；新花火演示已保存实际可见输入、回复和工具记录，未取得的模型内部推理明确标为缺失。见 [消息采集接口](docs/agent-messages.md)。

**花火三子智能体实局**：[云端审计页](https://coop.neutrinophysics.cn/#episode=5286719d-dcf7-48d1-81e8-2c1d2ba5c639)，服务器自动计分 **23/25**，61 个有效动作、1 次错误。372 条可见消息及工具记录逐条回读一致，6 个原始附件下载后哈希一致，回放通过。已捕获轨迹未发现违规交流或自己的暗牌泄露；这不是操作系统级隔离证明，也不包含隐藏 thinking。[独立逐玩家审计](docs/hanabi-agent-demo-review.md)

**沟通与失败复核**：机械部署脚本曾跳过聊天，不能把它的输赢当成模型表现。已修复本地 policy-evaluation 继承机械调度而挤掉沟通机会的问题；HTTP 游戏接口没有该过滤。发牌前通用大厅尚未实现，Crew 的这部分流程仍有缺口。[逐局证据与共用层审计](docs/communication-and-failure-audit.md)

**长期保存与附件**：历史轨迹、消息和 Agent 原始附件无自动过期或删除；空间不足明确拒绝新增写入，保留旧记录。原始文件支持分块上传、断点续传和 SHA-256 核验。网页展示全员牌背数量、沟通、消息与附件。见 [附件接口及上传命令](docs/agent-artifacts.md)、[Take Time 官方沟通规则](docs/take-time-communication.md)。

**2026-09-17 安全更新**：独立且可撤销的审计员/测试管理员凭证、输入复杂度限制、请求限速、持久化存储预算、重复观察复用、脱敏安全日志。见 [安全审计](docs/security-audit.md)、[本机 Windows 检查](docs/windows-security-check.md)、[云端部署](docs/cloud-deployment.md)、[已安装云端服务与维护](docs/cloud-installed.md)。0.4.1 客户端及其本地模式包含当前源码修复；旧 0.3.0 安装包仅作为历史产物保留。

## 安装与使用

**当前云端 API：`https://coop.neutrinophysics.cn:34935/api/v1`。** 2026-09-18 已验证个人凭证认证及轨迹读取；0.5.0 源码默认使用此地址。0.4.1 新安装用户需将旧默认地址改为此地址。该端口只提供 API，审计界面在桌面客户端中。[部署与证书状态](docs/cloud-api34935.md)

0.5.0 的默认入口为**用户名 + 密码登录**；尚未设置密码时，先用组织者提供的个人凭证登录，再到右上角「设置」设置密码。设置面板同时管理 API 地址、连接检查、当前账户与「记住登录」。当前云端已部署账户接口，owner 尚未设置密码；没有替用户设置真实密码。其他旧后端仍可使用「个人凭证」登录。[0.5.0 发布与云端验证](docs/release-0.5.0.md)

顶部状态灯显示灰色未连接、黄色检查中、绿色身份验证成功、红色失败及原因；每 20 秒检查一次，支持手动检查。远程 HTTPS 与本机 loopback HTTP 地址均可配置。主进程持有登录会话；可选系统加密存储会话，不保存账户密码，不记住时仅驻留内存。退出清除当前页面缓存和本机登录状态，并尝试撤销当前服务器会话。[完整说明](docs/desktop-client.md)

每个 Agent 只取得自己的 `baseUrl`、`episodeId`、`seatToken`，可在不同电脑连接同一后端。服务器持续保存轨迹，关闭客户端不会停止远程对局。`auditor` 仅审阅，不能创建对局。

现有北京服务器按备案完成后提供 API 的方案继续使用。桌面客户端不会绕过备案拦截；换成 8080 / 8443 也不能替代备案。[腾讯云备案说明](https://cloud.tencent.com/document/api/243/19630)

**Windows 0.6.0**：[本地安装包](release/Coop-Bench-0.6.0-win-x64.exe)。新增三人一屏回放，手牌、可见信息、思考与行动并列；技术信息移入完整记录。294 项自动测试、31 项包内远程检查和 14 项单机检查通过，安装器未签名。[本次更新与验证](docs/release-0.6.0.md)。Mac 安装包及各提交 CI 状态见 [GitHub Actions](https://github.com/neutralino-ai/coop-bench/actions/workflows/desktop-build.yml)；安装包和本地验证 artifacts 不纳入 Git。

历史 0.4.1 为 24 项远程检查、14 项本地检查、251/251 自动测试；0.3.0 为历史单机版本。历史记录不替代当前版本验收。

## 开发与无窗口运行

**localhost 演示服务**使用 `http://127.0.0.1:8788`，仅绑定回环地址，需自行启动。启动命令、Agent 工具桥接和三玩家 HTTP 试玩见 [本地服务与试玩说明](docs/localhost-demo.md)。

开发使用 **Node.js 24.21.0 + pnpm 11.19.0**。无窗口 API 无第三方运行时依赖；桌面开发和打包需要安装锁定依赖。安装包用户无需安装 Node。

```sh
npm install --global pnpm@11.19.0
git clone https://github.com/neutralino-ai/coop-bench.git
cd coop-bench
pnpm install --frozen-lockfile
pnpm test
pnpm desktop        # 远程客户端
# pnpm desktop:local  # 桌面单机环境
# pnpm start          # 无窗口本机 API
```

打开 **http://127.0.0.1:8788** 进入 Rollout 审计台。使用协调者凭证连接，浏览对局、逐步回放、切换玩家视角、记录反思和审阅意见。Take Time 有六格卡牌可视化，其余游戏提供通用的结构化状态视图。原来的动作调试台移至 **http://127.0.0.1:8788/play**；创建对局后给每位 agent 独立的座位凭证。

SQLite 默认保存到当前用户的应用数据目录：Windows `%APPDATA%\Coop Bench`，macOS `~/Library/Application Support/Coop Bench`。无窗口入口的 `COOP_DATA_DIR`、`COOP_DB`、`COOP_ADMIN_TOKEN`、`PORT` 可覆盖配置；代码版本变化会拒绝静默续玩旧状态。旧版 `data/episodes.sqlite` 不会被自动搬走，可通过 `COOP_DB` 显式指定；旧构建的未完成对局需要原版本引擎才能续玩。

## 能玩哪些范围

| 游戏 ID | 场景 ID | 人数 | 实际范围 |
|---|---|---:|---|
| `sky-team` | `yul` | 2 | 官方 YUL 教学航线，全部基础操作 |
| `crew-deep-sea` | `official-promo-1`、`official-promo-1-three-tricks` | 3–5 | 官方 Promo 1 的两墩任务及印刷的三墩挑战 |
| `bomb-busters` | `official-mission-1` | 2–5 | 官方 Mission 1，24 条蓝线，无公共设备 |
| `crew-planet-nine` | `official-mission-1` … `official-mission-3` | 3–5 | 官方前三个任务 |
| `the-gang` | `base` | 3–6 | 2024 完整基础版，无专家卡 |
| `take-time` | `official-clock-1-1` | 2–4 | **Chapter 1, Clock 1（1-1）**；复用既有引擎 |
| `hanabi` | `base` | 2–5 | Cocktail Games 2019 五色版 |
| `magic-maze` | `pnp-2017-discovery` | 1–8 | **2017 官方 PnP 试玩版**九张地图；不代表零售版全部场景 |
| `the-mind` | `base` | 2–4 | 基础明置模式，完整 12／10／8 级 |
| `the-game` | `base` | 1–5 | 完整基础牌组与规则 |

`/games` 是可运行注册表，包含来源、人数、官方场景、规则摘要及实现遗漏。[准入报告](docs/implementation-admission.md)逐款解释取舍。[机器清单](catalog/ranked-games.json)保留此前排名快照与本轮实现状态。

## 共用能力

- **规则核**：`setup → observe / legalActions → step → outcome`；实时游戏另有系统专用 `advanceTime`。
- **玩家工具**：`read_rules`、`observe`、`send_message`、`act`。发送消息仍需满足该游戏的沟通规则。
- **观察隔离**：只给本人能看的信息；每人有独立可见更新游标，避免轮到自己时漏掉期间的公开行动和一次性提示。
- **状态服务**：SQLite事务、座位鉴权、观察版本校验、幂等重试、重启恢复、真实时钟、终局审计与重放。
- **训练准备**：同一规则核可本地批量运行；导出本人观察、动作、结果与终止/截断标签。同根种子的派生场景统一分组。

自由时序、轮流行动、密封提交和沟通阶段由各游戏决定，不统一改成轮流发言。The Mind 的时机策略、Sky Team/Gang/Game/Bomb 等的语言语义限制需要独立审计；机械赢局不自动证明沟通合规。完整 SFT 数据筛选和 RL 训练器尚未接入。

## 代码与文档入口

| 文件 | 用途 |
|---|---|
| [远程桌面客户端](docs/desktop-client.md) | 0.6.0 一屏回放、设置、账户登录、Agent 分发与跨平台构建边界 |
| [新电脑开发指南](docs/development.md) | 独立克隆、pnpm、Windows / macOS 与 CI |
| [src/types.ts](src/types.ts) | 已执行的游戏适配器契约 |
| [src/registry.ts](src/registry.ts) | 10 款注册表，按核实范围创建 |
| [接入一个游戏](docs/adding-a-game.md) | 游戏插件与共用服务的边界、计分与信息隔离要求 |
| [src/authority.ts](src/authority.ts) / [server.ts](src/server.ts) | SQLite 权威状态与 HTTP |
| [src/agent-tools.ts](src/agent-tools.ts) / [player-client.ts](src/player-client.ts) | 每玩家独立的模型无关工具 |
| [src/local-runner.ts](src/local-runner.ts) / [smoke.ts](src/smoke.ts) | 本地策略回调、回放、全组合机械验证 |
| [运行 API 与流程](docs/runtime-api.md) | 端点、权限、重试、更新游标、计时与训练语义 |
| [Rollout 保存与人类审计](docs/rollout-audit.md) | 自动保存、时间线、视角、反思、旧记录与版本 |
| [本地 runner](docs/local-runner.md) | 接策略示例、调度约定、数据导出 |
| [长期机制设计](docs/stateful-api-design.md) | Serverless、SQL/Redis、加密状态包与扩容取舍 |

`pnpm smoke` 枚举所有已注册的 **47 个场景与人数组合**，把状态、错误、截断与逐局回放结果写到 [artifacts/smoke-report.json](artifacts/smoke-report.json)。示例轨迹是机械测试材料，不能当作智能体能力实验或专家 SFT 示范。其中完整审计含特权数据，不能整份交给玩家。

Take Time 引擎已纳入 `src/vendor/take-time/`，构建和测试无需相邻仓库；来源与校验值见 [vendor-lineage.json](docs/vendor-lineage.json)。其原有研究变体不注册进本环境。完整战役、模型训练优化器及吞吐压测仍是后续工作。
