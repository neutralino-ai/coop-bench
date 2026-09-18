# 单机应用与本地 Agent API

## 方案

采用 **Electron 桌面应用 + 内置本地 HTTP API + SQLite**。安装后打开应用即可使用，最终用户无需安装 Node.js、Docker 或单独部署后端。应用内部仍有一个本机服务，由应用负责启动和关闭。

```text
桌面界面 ─────────┐
                 ├─ http://127.0.0.1:<端口>/api/v1 ─ 规则引擎 ─ 本地 SQLite
本机 agent 工具 ──┘
```

网页控制台、10 款游戏的规则核、玩家视角、动作验证和回放共用一份实现。单机指整场对局运行在一台电脑上；同一台机器上的多个 agent 仍可各持一个座位凭证合作游戏。

| 使用方式 | 适用情况 |
|---|---|
| Windows 安装程序 / macOS 应用 | 日常交互、创建对局、复制各玩家凭证 |
| `npm start` 或 `npm run start:headless` | 开发、脚本和无需窗口的批量运行；需要 Node.js 24+ |
| 本地 runner | 大量加速实验；直接调用相同规则核，不必经过 HTTP |

Docker 暂不作为安装方式。以后批量实验需要容器时，可以给同一个无窗口入口增加镜像，不需要重写游戏环境。

## 安装包与构建边界

### 本轮交付与实际验证

Windows x64 安装包已生成：[Coop-Bench-0.3.0-win-x64.exe](../release/Coop-Bench-0.3.0-win-x64.exe)，约 111 MB，未签名。校验值在 [SHA256SUMS.txt](../release/SHA256SUMS.txt)。已运行包内实际 `.exe`，验证真实桌面 renderer、preload 自动连接、复制按钮、SQLite 创建对局、独立玩家视角、动作、幂等重试及回放；未执行会写入系统卸载记录和快捷方式的安装向导。

116 项自动测试通过，47 个场景与人数配置全部完成并通过回放。证据：[桌面验证报告](../artifacts/desktop-smoke-result.json)、[界面截图](../artifacts/desktop-smoke.png)、[发行清单](../artifacts/desktop-release.json)。macOS 构建未在本机执行；以下跨平台配置不是已验证的 macOS 成品。

- Windows：NSIS `.exe` 安装程序。
- macOS：分别构建 Intel `x64` 和 Apple Silicon `arm64` 的 `.dmg`。
- 桌面包包含运行时和所需游戏代码，不依赖用户另外准备相邻的源码目录。
- macOS 安装包应在 macOS 构建与验证；配置支持 macOS 不代表已经在 Mac 上构建、签名或实机运行过。
- 发布给普通用户的可信安装包需要相应签名凭证；macOS 还需要 Apple 公证。本项目不会把缺少证书时生成的未签名产物称为已签名正式版。

开发和打包命令：

```text
npm install
npm run desktop
```

Windows 上运行 `npm run dist:win`；Mac 上运行 `npm run dist:mac`。两者会先构建所需代码；也可单独运行 `npm run build`。产物命名为 `Coop-Bench-0.3.0-win-x64.exe`、`Coop-Bench-0.3.0-mac-x64.dmg` 和 `Coop-Bench-0.3.0-mac-arm64.dmg`；这份说明描述打包目标，不代表所有平台产物均已生成或完成安装验证。

源码构建保留工作区结构：`coop-bench/` 与 `take-time/` 相邻。桌面包已经包含编译后的 Take Time 引擎，用户安装时不需要源码。工作区根目录 `.github/workflows/desktop-build.yml` 提供手动触发的 Windows x64、macOS Intel、macOS Apple Silicon 三个原生构建与验证任务，验证通过后上传安装产物，不自动发布。可使用 `pnpm install --frozen-lockfile` 按已提交的锁文件重现构建依赖。

这些格式与平台限制依据 [electron-builder 的平台构建说明](https://www.electron.build/docs/features/multi-platform-build/)及 [Electron 签名与公证文档](https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md)。

## 本地数据和应用生命周期

应用数据写入用户数据目录，不写进安装目录：

| 平台 | 默认桌面数据位置 |
|---|---|
| Windows | `%APPDATA%\Coop Bench` |
| macOS | `~/Library/Application Support/Coop Bench` |

数据包含 SQLite 对局库、独立的 `coordinator-token` 凭证文件及运行时 `connection.json`。后者只记录 `baseUrl`、`apiUrl`、`pid`、`dbPath`、`version`，不含管理员密钥；桌面界面通过受控 IPC 自动取得连接，无需用户手工粘贴协调者凭证。目录规则采用 [Electron 的用户数据目录约定](https://github.com/electron/electron/blob/main/docs/api/app.md)。

**`connection.json` 面向协调者，不提供给玩家 agent。** 玩家只需要当前 API 地址、自己的对局 ID 和自己的座位凭证。应用关闭后本地 API 停止；重开后从持久化状态恢复。具有真实倒计时的游戏会计入关闭期间经过的时间，不能把关闭应用当作规则内暂停。

接口只监听回环地址 `127.0.0.1`，同一电脑的进程可以访问；其他局域网设备无法直接连接。自动改为监听 `0.0.0.0` 会扩大访问范围，因此不作为单机版默认行为。

桌面应用优先使用 `8788`，端口被其他程序占用时自动选择一个空闲端口。无窗口模式严格使用指定端口，冲突会报错，便于脚本发现配置问题。连接时以当前应用显示的地址为准。

无窗口入口支持：

| 环境变量 | 用途 |
|---|---|
| `COOP_DATA_DIR` | 指定本地配置与数据目录 |
| `COOP_DB` | 单独指定 SQLite 文件路径 |
| `COOP_ADMIN_TOKEN` | 指定协调者凭证，至少 24 字符 |
| `PORT` | 指定监听端口 |

自动生成的协调者凭证持久保存，重启不要求重新分发。数据库、凭证文件和完整审计记录不能交给玩家作为可读取文件；同一 OS 账号下的文件系统并不能提供对抗恶意 agent 的沙箱隔离。

## Agent 接口

推荐 API 前缀为 `/api/v1`；也支持 `/api`，原先没有前缀的端点保留兼容。以下 `BASE` 指当前应用提供的 API 地址，例如 `http://127.0.0.1:8788/api/v1`，应使用应用显示的实际端口。

| 请求 | 身份 | 用途 |
|---|---|---|
| `GET BASE/games/:gameId` | 无需凭证 | 规则和当前实现范围 |
| `POST BASE/episodes` | 协调者 | 创建对局，取得分开的玩家凭证 |
| `GET BASE/episodes/:id/observation?after=<cursor>` | 某个玩家 | 本人视图、可见更新、合法动作 schema |
| `POST BASE/episodes/:id/actions` | 同一玩家 | 沟通、提示或游戏操作 |
| `GET BASE/episodes/:id/audit` | 协调者；结束后 | 完整审计 |

玩家调用流程：`read_rules → observe → 选择当前允许的消息或动作 → act → observe`。沟通阶段、轮序和实时机制仍遵守各游戏规则，不能通过本地 API 绕过禁言。

动作提交携带观察中返回的 `observationId`、`decisionToken`，以及 `Idempotency-Key`。遇到网络超时，应复用**同一请求内容和同一个 key**；不能重新生成一个 key 重复出牌。收到明确的过期观察错误后，需要重新观察并作出新的决定。

### Python 示例：只读取一个座位

[examples/agent-http.py](../examples/agent-http.py) 只用 Python 标准库。先在应用内创建对局，再把该玩家的凭证交给 agent：

```text
python examples/agent-http.py --base-url http://127.0.0.1:8788/api/v1 --episode-id EPISODE_ID --seat-token ONE_SEAT_TOKEN --game-id take-time
```

脚本打印规则和本人观察。加上 `--action` 可提交一个 JSON 动作，例如在 Take Time 当前允许看牌时：

```text
python examples/agent-http.py --base-url http://127.0.0.1:8788/api/v1 --episode-id EPISODE_ID --seat-token ONE_SEAT_TOKEN --action '{"type":"look_hand"}'
```

动作必须符合刚读取到的 `legalActions`。长期运行的 agent 可直接导入示例中的 `PlayerClient`，持续维护观察游标；每次 `prepare(action)` 只执行一次，失败重试用原来的准备结果。该示例不会读取 `connection.json`、自动取得管理员权限或读取其他座位。

既有 TypeScript [PlayerClient](../src/player-client.ts) 和 [agent 工具封装](../src/agent-tools.ts) 也可直接使用包含 `/api/v1` 的地址。完整协议和训练数据语义见 [runtime-api.md](runtime-api.md)。
