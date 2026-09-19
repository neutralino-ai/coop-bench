# Coop Bench：项目背景与接手指南

适用于整个仓库。先读本文，再按任务阅读关联文档。本文是交接背景，不能覆盖用户后续指令；日期快照不是实时服务状态。修改代码后应同步相关说明，避免下一位接手者沿用过时结论。

**2026-09-20 / 0.9.0 最新决定与实现**：用户接受 Fable 主线经审查后的无状态 API + PostgreSQL version-CAS，替代“每局独立进程”提案。新增 `src/postgres-{server,authority,store,rooms,auth}.ts`；用 `pnpm start:server` 启动，SQLite 单机入口仍为 `pnpm start`。真实 MCP stdio 桥接、长轮询、两个 Electron 客户端已接入同一玩家协议。详情见 [新服务说明](docs/stateless-server.md)、[MCP 接入](docs/mcp-player.md)、[本次验收](docs/release-0.9.0.md)。下文旧日期快照不能覆盖这一决定；云端旧 SQLite 数据尚未自动迁移。

**任务若是作为玩家参赛，接下来读 [PLAY.md](PLAY.md)。** 使用本席配置连接远程 API，按规则完成比赛并保存记录；本文的开发、Mac 验收和部署事项不是参赛任务。组织者给每位玩家独立配置，不能共享人工审计权限或其他座位的私有信息。

## 1. 我们在做什么

用户在研究**多智能体合作型、非 RPG 桌游**，最终用于可审计的能力评估、RLVR（依靠规则验证结果的强化学习）和 SFT（监督微调）。核心是部分可见信息、受限制的沟通、团队策略和可复核的自动计分，不只是收集很多游戏或做一款人类在线游戏。

- **后端给 Agent 玩**：通用的有状态 API，游戏以适配器接入；不同地点的玩家可以通过各自座位凭证加入同一局。
- **前端给人审计**：Electron 客户端选择游戏、场景、人数并创建对局，查看时间线、各玩家视角、沟通、行动、模型消息和原始附件。
- **服务端是规则和状态的权威**：保存对局，验证合法行动，自动计分，支持重放与训练数据导出。默认远程客户端不在用户电脑启动游戏服务；`--local` 保留单机模式。
- 用户要求长期保存所有轨迹和附件。不能为了节省空间自动删除旧记录；达到预算时应拒绝新写入，并明确报告。
- 需要的是**比赛过程中的原始 messages trajectory**：模型输入、输出、工具调用、工具结果，以及模型 API 实际提供的 reasoning。赛后反思不能替代这些记录；摘要、token 计数、加密字段和不可获得的内部思考必须分别标注，不能伪造“完整 thinking”。

目前注册 10 个适配器：Sky Team、The Crew: Mission Deep Sea、Bomb Busters、The Crew: The Quest for Planet Nine、The Gang、Take Time、Hanabi、Magic Maze、The Mind、The Game。每款仅覆盖已核实的规则与组件范围，**不是全部战役、扩展和关卡**。以 [README 游戏表](README.md#能玩哪些范围)、[准入报告](docs/implementation-admission.md)及 `src/registry.ts` 为准。

## 2. 研究与规则方面不能丢失的约束

- 玩家只能取得规则允许的信息。人工审计权限、全局状态、队友私有消息、座位凭证不能进入玩家输入。
- 不用跨 Agent 私聊补充规则禁止的交流。讨论是否允许、发生在发牌前还是发牌后、可见哪些牌背信息，均由游戏规则决定，不统一改成“轮流说话”。
- Take Time 曾出现对官方沟通阶段、牌背太阳/月亮信息和明暗置规则的误解。修改前读 [官方沟通说明](docs/take-time-communication.md) 和 [失败复核](docs/communication-and-failure-audit.md)，不能套用最初的研究变体。
- 0.8.0 已实现通用发牌前邀请房间；它不补造各游戏未核实的官方讨论步骤。Crew 的相关流程仍需补足；部分游戏的语言语义限制仍需独立审计。完整 SFT 数据筛选和 RL 训练器尚未接入。
- 机械 smoke 的赢局不是 LLM 能力证据，合成 UI 测试不是智能体实局。Hanabi 历史三智能体演示为 23/25；其可见消息已审计，但没有可获得的隐藏 thinking，也不构成操作系统级防作弊证明。
- 旧 episode 的 build 不能改写。遇到 `BUILD_MISMATCH` 使用对应归档 runtime；不能移除校验来“修复”历史回放。

## 3. 代码地图

| 位置 | 作用 |
| --- | --- |
| `src/types.ts`、`src/games/`、`src/registry.ts` | 适配器契约、规则核、游戏注册 |
| `src/authority.ts`、`src/server.ts` | SQLite 权威状态、HTTP API、幂等和观察版本检查 |
| `src/rollout-store.ts`、`message-store.ts`、`artifact-store.ts` | 轨迹、比赛消息、分块附件持久化 |
| `src/access-control.ts`、`src/human-auth.ts` | 人工角色、密码、短期会话；与玩家座位权限分离 |
| `src/agent-tools.ts`、`src/player-client.ts`、`scripts/agent-message-recorder.mjs` | Agent 接口和原始消息采集 |
| `desktop/main.mjs`、`remote-session.mjs`、`preload.cjs` | Electron 主进程、受限网络桥接、系统加密存储 |
| `src/room-store.ts`、`client/`、`desktop/player-main.mjs` | 邀请房间、本席 SSE/POST 运行器、独立参赛应用 |
| `web/` | 人工审计 UI、设置、连接状态、密码操作 |
| `desktop/local-main.mjs`、`src/local-runner.ts` | 可选单机模式及本地策略运行 |
| `test/`、`experiments/` | 自动验证；实验设计不等于生产实现 |
| `build/`、`.github/workflows/desktop-build.yml` | Windows / Mac 打包和原生 CI |
| `deploy/`、维护脚本 | 既有云端运维；Mac 客户端测试不需要执行它们 |

Take Time 引擎及少量维护辅助代码已内置在 `src/vendor/` 和 `scripts/vendor/`，来源见 [vendor-lineage.json](docs/vendor-lineage.json)。这是独立仓库，不依赖相邻的 `take-time`、DDNS 或报销项目目录。

## 4. 接手时的已知基线（2026-09-18）

- 公开仓库：<https://github.com/neutralino-ai/coop-bench>；版本 `0.7.2`。
- Node.js `24.21.0`，pnpm `11.19.0`。使用 `pnpm-lock.yaml` 和 `pnpm install --frozen-lockfile`，不另建 npm 锁文件。
- Windows 本机 0.7.1：299 项测试、包内远程 37 项和本地兼容 14 项通过；一屏回放在 1280×800 与 1440×900 验证。详见 [0.7.1 更新](docs/release-0.7.1.md)。
- [首次三平台 CI](https://github.com/neutralino-ai/coop-bench/actions/runs/35302731612) 的 Windows x64、Mac Intel、Mac Apple Silicon 均通过，测试代码提交为 `0b9c6eb8d4f7583cfd8dc43adfa670ef8edeb2dc`。CI 包含打包后远程客户端运行；不等同于用户电脑上的安装向导、Gatekeeper 和实际钥匙串验收。
- 版本 tag 的三平台 CI 通过后，安装器发布到 GitHub Releases；CI 的附加验收 Artifacts 保留 14 天。当前安装器未签名，Mac 未做 Apple 公证。
- API 默认 `https://coop.neutrinophysics.cn:34935/api/v1`。注意域名拼写；旧文档中的 443 网页链接是历史入口。根路径 `/` 返回 404 属于 API-only 设计，连接检查使用 `/api/v1/health` 和认证后的 `/api/v1/identity`。
- 升级快照 build：`0286cbc0bbd21bfe0c8e2797f71dba2474c198cc25ec60c36a293d173b285af0`。旧库 17 表逐行哈希一致，保留 3 局、372 条消息、9 个附件。
- 当时 owner 尚未设置密码；后续可能已改变，接手时通过账户接口核实，不能重置。当前部署细节见 [0.5.0 记录](docs/release-0.5.0.md)。

## 4.1 0.7.1 更新

**2026-09-19 / 0.8.0 新增**：当前源码增加邀请房间、原子开局、本席 SSE、服务端 60 秒必需行动窗口、独立 Coop Bench Player、无界面最小模型与 JSONL 外部 Agent 运行器。详见 [会话与客户端说明](docs/player-sessions.md)及 [0.8.0 验收记录](docs/release-0.8.0.md)。本次没有升级腾讯云；下面“尚未实现”是先前设计快照，当前以新说明为准。多 worker、MCP 和长轮询仍未实现。新 UI 在旧生产服务上无法使用房间 API，不要误判成密码错误。

Mac 接手需要同时构建管理端与参赛端，并运行 `desktop/ci-player-smoke.mjs` 验收真正包内的 Player；现有管理端命令和 Keychain/Gatekeeper 实机要求继续适用。不同席位必须使用独立运行器目录，不能读取彼此 SQLite 或 messages.jsonl。

**历史决定，已被 0.9.0 替代**：9 月 19 日曾选择每局独立 Node 子进程，当时仅修改设计文档。9 月 20 日用户接受无状态 API + PostgreSQL CAS；不再为每局分配常驻进程。见 [设计第 11 节](docs/agent-session-design.md#11-对局处理单元worker-与扩容)。

**2026-09-19 接口研究与只读审计**：见 [Agent 对局接口设计](docs/agent-session-design.md)和[花火低分复核](docs/hanabi-low-score-audit-2026-09-19.md)。大厅、MCP、长轮询均为提案，尚未实现。DeepSeek 一局的 23 次请求保留了本人对话，但遗漏 API 的 updates；当前 view 与合法动作逐次一致。另两局缺模型 messages，其中一局标记确定性控制策略，不能统称 LLM 能力失败。PLAY.md 已强调累计尚未送入模型的事件与实际请求记录。

**后续设计约束**：用户明确要求服务端必需行动窗口强制 **60 秒**。最新提案采用最小邀请制房间、客户端内默认 Agent（用户配置模型 API）、SSE 下行事件 + HTTP POST 动作、长轮询兼容；运行器基础设施与策略配置分开记录。见接口设计第 9–10 节。以上仍未部署，不能把网络 socket timeout 说成已有行动超时。

**0.7.2 后续修复**：见 [发布说明](docs/release-0.7.2.md)。增加静态启动提示、回放占位 / 超时重试、取消旧请求；首屏不预取整局消息和附件清单，按选中步骤读取本局缓存。GET 限流重试有上限，POST 不自动重试。复制座位配置包含游戏、场景、玩家。Windows 303 项自动测试、41 项开发 / 包内远程检查通过；打包 UI 对云端花火只读实测首屏 1.92 秒。Mac 按对应 tag 的 CI 与实机结果区分。没有新增 MCP 服务器或修改云端游戏核。

- 用户已授权将仓库改为公开；代码历史已检查，真实凭证、数据、规则书下载和模型轨迹仍不得提交。
- 设置增加 GitHub Releases 更新：按当前平台 / 架构选安装包，固定仓库，不使用游戏凭证，校验 SHA-256 后由用户打开安装器。`desktop/update-client.mjs` 是主进程实现。三平台 CI 全部通过后，版本 tag 才会发布 Release。
- 新增顶部“游戏规则”；花火显示全队剩余提示 / 8 及标记，并随选中的历史时点变化。游戏引擎没有变更。
- 2026-09-18 密码排查：owner 密码已成功保存，之后登录被认证拒绝；绑定和账户状态正常。尚未证明具体输入差异，不能把 UI 输入提醒说成根因已修复，更不能擅自重置密码。
- 首次请手动安装 0.7.1；0.7.0 的 Electron 网络库拒绝 GitHub 302 下载，补丁已改用 Node fetch。包内验收现在走真实 HTTP 302，公开下载也已核对摘要。详见 [0.7.1 说明](docs/release-0.7.1.md)。

## 4.2 回放 UI 的用户要求（0.6.0 起）

- 默认一屏看到每个玩家的手牌、合法可见信息、决策记录和动作，关键正文保持 15–16px 以上。不要把 ID、哈希、建局表单、整局消息和附件再堆回主屏。
- `web/replay-model.js` 处理历史数据关联，`web/replay-ui.js` 组织玩家列，`web/replay.css` 控制紧凑布局；现有 `web/app.js` 继续负责认证、原始证据与 API。
- 手牌是当前所选动作前的同一时点；非行动者的思考/动作是标明步号的最近一次决策。不能把后续信息倒填，也不能把投影说成 Agent 实际读取过的观察。
- 花火审计牌面与玩家自身提示知识必须明确分开。原始 messages 按座位和 observationId 关联，无法对应时保留在分页原始记录，不猜测配对。
- 在 Mac 上继续验收新布局及原文弹窗，不能只沿用 0.5.0 的截图或测试结论。

## 5. 下一位在 Mac 上先做什么

**优先完成真实 Mac 验收并修复发现的问题，不先扩游戏或改生产服务。** 用户已有 Mac，CI 已证明两种架构可以构建，尚需确认真实安装与日常使用体验。

### 5.1 读取与准备

1. 运行 `git status --short`，保留用户已有修改；记录当前 commit、macOS 版本、CPU 架构和 Node 架构。Apple Silicon 上的 Rosetta x64 进程不能记作原生 arm64 验收。
2. 读 [桌面说明](docs/desktop-client.md)、[开发说明](docs/development.md)、[账号接口](docs/human-auth.md)和本节。
3. 不复制 Windows 的 `.tools/`、`node_modules/`、安装包缓存或加密登录配置。Mac 使用自己的原生依赖和钥匙串。

以下命令在仓库根目录的 macOS shell 执行，先准备 Node 24.21.0：

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm test
pnpm build

MAC_ARCH="$(node -p 'process.arch')"
case "$MAC_ARCH" in arm64|x64) ;; *) echo "Unsupported architecture"; exit 1 ;; esac
mkdir -p artifacts
MAC_RUN_DIR="$(mktemp -d "$PWD/artifacts/mac-handoff-XXXXXX")"

# 开发版：90 秒有界测试，使用全新的合成数据和账号。
node desktop/ci-client-smoke.mjs \
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$MAC_RUN_DIR/development" "$MAC_ARCH" --development

# 先构建当前原生架构；不自动发布、不读取签名身份。
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder \
  --config build/electron-builder.json --mac dmg zip "--$MAC_ARCH" --publish never

if [ "$MAC_ARCH" = arm64 ]; then
  MAC_APP="release/mac-arm64/Coop Bench.app/Contents/MacOS/Coop Bench"
else
  MAC_APP="release/mac/Coop Bench.app/Contents/MacOS/Coop Bench"
fi

# 分别验证打包后的远程客户端和单机模式，每次使用不同目录。
node desktop/ci-client-smoke.mjs "$MAC_APP" "$MAC_RUN_DIR/packaged-remote" "$MAC_ARCH"
node desktop/ci-smoke.mjs "$MAC_APP" "$MAC_RUN_DIR/packaged-local" "$MAC_ARCH"
```

开发版、包内远程测试生成 `client-smoke-result.json`，单机测试生成 `desktop-smoke-result.json`。检查退出码、`ok`、`version`、`arch` 和 `packaged`，不能只看窗口出现或构建命令成功。本地兼容模式的 Mac 验收是当前 CI 之外的补充项。

### 5.2 真实桌面操作

- 从当前架构的 DMG 安装并从应用目录启动，检查首次启动提示、Dock、菜单、缩放、滚动、退出和重开；不要仅测试开发版或 `release/` 内的 `.app`。
- 操作测试用新的 `--data-dir`，不覆盖已有用户配置。例如：`"$MAC_APP" "--data-dir=$MAC_RUN_DIR/manual"`。安装到应用目录后的验收应将可执行文件路径换成实际安装位置。
- 验证设置中的 API 编辑、当前身份、密码状态，及灰／黄／绿／红连接灯。检查错误密码与网络失败能被区分；断网、恢复、睡眠唤醒后状态应更新，正常心跳间隔 20 秒。
- 用**合成测试账号**验证首次设置密码、修改密码、旧会话失效、退出、输入框清空。不要替用户设置或修改生产 owner 密码。
- 验证 Mac Keychain 提示、“记住登录”、完全退出后恢复，以及退出后不再恢复。smoke 在系统加密不可用时会记录跳过；这种结果不能写成钥匙串验证通过。保存的是系统加密的会话，不是密码。
- 验证 10 游戏目录、游戏／场景选择、轨迹时间线、玩家视角、原始 messages、附件下载、复制座位配置。需要创建对局、写消息或改密码的测试先在隔离本机环境完成。
- 未签名、公证导致的提示需如实记录。不要关闭系统范围的 Gatekeeper、清空钥匙串或关闭 TLS 校验来让测试变绿。

### 5.3 可选的真实云连接

离线构建和合成验收不需要生产凭证。用户已经提供授权账号时，再做云端**只读**检查：健康检查、个人身份、游戏列表、已有 rollout、消息和附件。通过 UI 或私有本机文件提供凭证，不粘贴到聊天、命令参数、报告或 Git。

`scripts/verify-live-api-desktop.mjs` 当前使用 Windows `release/win-unpacked/resources/app.asar` 路径，并依赖本地未提交的 owner 文件，**不能直接当成 Mac 命令**。如需迁移这份验证器，先参数化 Mac ASAR 路径和凭证来源，保留“仅 GET、不向 renderer 返回 token”的边界。

历史花火 episode 为 `5286719d-dcf7-48d1-81e8-2c1d2ba5c639`，当时得分 23/25。新 runtime 能审阅旧记录，不应为了重放旧 build 而修改历史数据。

## 6. 权限、数据与生产边界

- `operator` 可建局和审计，`auditor` 仅审阅；玩家使用每局独立 seat token。人工凭证和人工密码会话不能冒充玩家座位。
- 首次设置密码需已有个人凭证。正常登录用账号 ID 和密码；修改已有密码需当前密码。账号可能禁用或到期，不能为了测试移除权限检查。
- 凭证留在 Electron 主进程，IPC 仅开放明确的接口；保持 sandbox、context isolation、CSP 和远程 HTTPS 验证。HTTP 仅允许本机回环。
- `.gitignore` 排除真实 `artifacts/`、数据库、环境文件、私钥、凭证、机器配置和生成产物。提交前仍需审查实际 staged 内容；私有 GitHub 仓库也不能存这些秘密。
- 云主机背景：`ubuntu@62.234.160.98`，后端 `coop-bench.service` 监听 `127.0.0.1:8788`，独立 `coop-bench-api-proxy.service` 对外提供 34935。数据在 `/var/lib/coop-bench/`，认证库为独立 `human-auth.sqlite`；游戏库与认证库均有备份。
- Mac 验收不需要运行 DNS、防火墙、SSH 部署、账号重置或云升级脚本。云机器同时有其他服务；不要顺手修改全局 Nginx、报销服务、DNS 或防火墙。
- 如果用户另行要求部署，先检查现状、备份、固定发布包和回滚方式；保护旧轨迹、附件和 build 身份。[运维记录](docs/cloud-api34935.md)包含证书续期的已知问题，不要假定续期已正常。

## 7. 交付要求

- 按改动做必要验证：游戏改动测合法动作、信息隔离、计分和重放；认证改动测拒绝路径、会话轮换和并发；桌面改动必须验实际打包程序。纯文档改动检查路径与命令，不必重跑整套游戏测试。
- 原始测试证据留在被忽略的 `artifacts/`；提交一份脱敏的 `docs/` 测试报告，记录 Mac 型号／架构、系统版本、commit、构建标识、命令、通过／失败／跳过、安装与钥匙串实测结果和剩余问题。
- 区分 CI 自动通过、真实 Mac 手工通过、合成数据测试和真实云只读验证，不把其中一种当成另一种。
- 只提交与任务相关的变更，保留用户修改。按用户要求同步 GitHub 仓库；最终说明修改了什么、测了什么、仍有什么限制。

更多入口：[游戏插件开发](docs/adding-a-game.md)、[运行 API](docs/runtime-api.md)、[Agent 消息](docs/agent-messages.md)、[附件](docs/agent-artifacts.md)、[安全审计](docs/security-audit.md)。
