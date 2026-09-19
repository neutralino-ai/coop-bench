# 邀请房间、参赛运行器与两类客户端（0.8.0）

本页描述仓库实现。**本次未部署腾讯云生产服务**；旧服务没有这些房间与 SSE 路由，需先升级后端才能让新参赛客户端连接。现有直接 episode/seat API 仍保留。多 worker 集群和 MCP 服务尚未实现。

## 三层职责

| 层 | 实现 | 权限与工作 |
|---|---|---|
| 游戏服务器 | `src/authority.ts`、`room-store.ts`、`server.ts` | SQLite 权威状态，规则验证，原子发牌，自动计分，持久轨迹，期限扫描 |
| 本席运行器 | `client/runtime.mjs` | SSE 收件、游标恢复、POST 动作、幂等回执、本地持久待发队列、实际 JSON 记录 |
| 决策者 | 人类 / `client/minimal-agent.mjs` / 外部 JSONL Agent | 只从规则允许的本席信息选择动作；不持有人工审计权限 |

游戏核不调用模型、不保管模型密钥。运行器的 `decide(context, {signal, runtime})` 只提供限定的策略存储及记录器 facade，不暴露本席凭证或管理员工具。这是 API 边界，不是对同机恶意代码的操作系统沙箱。

### 两个独立桌面入口

- **Coop Bench**：原管理与审计客户端。选择游戏后点“创建邀请房间”，复制邀请；查看成员、移出玩家、待全部准备后开始。旧“创建对局”保留给直接分发 seat 配置的兼容用法。
- **Coop Bench Player**：独立参赛客户端。粘贴邀请，选择“我自己玩”或“模型 API Agent”，准备；首位加入者是房主。人类通过合法动作表单出牌；模型模式自动处理 SSE。花火有牌面、提示池、失误和牌堆视图；其他游戏先使用通用本席局面与 Schema 表单。

客户端都是本地静态页面 + Electron 主进程网络桥接；没有从游戏 API 加载远程可执行页面。邀请格式为 `coopbench://join#api=...&room=...&invite=...`，**当前粘贴进客户端使用，不依赖系统注册 URL 协议**。邀请密钥位于片段；不要在公开页面或 Git 中分享真实邀请。

参赛凭证与审计登录分别保存，参赛应用不要求 owner 密码。桌面席位凭证用系统加密保存；系统安全存储不可用时只保持当前进程，不明文降级保存。模型 API Key 仅在本次进程使用，退出后重新输入。“恢复上次席位”默认恢复人工模式，不能将其误记为模型自动续跑。

## 本机启动与打包

需要 Node 24.21.0、pnpm 11.19.0，先 `pnpm install --frozen-lockfile`。

```sh
pnpm start                  # 只监听 127.0.0.1，默认端口 8788
pnpm desktop                # 管理客户端；在设置中选择所需 API
pnpm desktop:player         # 独立参赛客户端
pnpm dist:win               # 管理端 Windows 安装器
pnpm dist:player:win        # 参赛端 Windows 安装器
pnpm dist:player:mac        # 需在 Mac 构建，Intel + Apple Silicon
```

本机管理员凭证按现有本机服务机制生成，参阅 [运行 API](runtime-api.md)。不要把管理员凭证交给参赛 Agent。两类安装器分别位于 `release/`、`release-player/`；应用 ID、用户数据目录互不相同。

## 房间 API

全部路径以 `/api/v1` 为前缀。鉴权使用 `Authorization: Bearer ...`，不用 URL 查询串携带凭证。

| 方法与路径 | 身份 | 作用 |
|---|---|---|
| `POST /rooms` | operator | `{gameId,scenarioId,playerCount,config?}`，返回 roomId 和一次性展示的 inviteToken；此时不发牌 |
| `GET /rooms` | operator | 最近 100 个房间的成员与生命周期信息 |
| `GET /rooms/:id/admin` | operator | 单房间管理视图，无玩家密钥 |
| `POST /rooms/:id/join` | 邀请 token | `{name,playerToken}`；运行器生成至少 32 个随机字节的 base64url playerToken；同一 token 的重试不重复占位 |
| `GET /rooms/:id` | 成员 token | 本席身份、公开成员和准备情况、开始后的 episodeId |
| `POST /rooms/:id/ready` | 成员 token | `{ready,rosterVersion}`；加入、退出、踢人使旧 ready 失效 |
| `POST /rooms/:id/start` | 房主成员 token | `{}`；人数齐、所有人确认当前 roster 后原子创建游戏并绑定席位 |
| `POST /rooms/:id/kick` | 房主成员 token | `{playerId}`；仅发牌前，撤销成员和旧邀请；之后需生成新邀请 |
| `POST /rooms/:id/leave` | 成员 token | `{}`；仅发牌前退出，房主退出后顺序移交 |
| `POST /rooms/:id/invite` | 房主成员 token | `{}`；生成新邀请并使旧邀请失效 |
| `POST /rooms/:id/admin-start` / `admin-kick` / `admin-invite` | operator | 对应管理操作；不返回玩家 token |

房间有效期为创建后 10 分钟，最多 1000 个保留房间，每房间最多 1000 个管理事件。达到上限拒绝新增，不删历史。开局后的成员固定；不会把退出当成让其他人接手隐藏牌的许可。加入重试使用同一个本地私有 playerToken；新的 Agent/房间使用独立数据目录。

房间没有自由聊天接口。游戏允许的讨论仍是游戏插件定义的 `speak` / `message` / `chat` 等动作，从本席 action API 提交；服务器保留合法阶段和可见性校验。

## 游戏事件与动作

```text
GET  /episodes/:episodeId/events?after=本席cursor   # Bearer 成员 token
POST /episodes/:episodeId/actions                  # 同一 token + Idempotency-Key
```

SSE 类型为 `observation`，数据为 `{observation,serverTime}`；`id` 是该席持久可见更新 cursor。断线后可用 `after` 或 `Last-Event-ID` 续接，收到的观察含尚未读取的本席 `updates`。首包始终提供当前完整观察，终局发完即结束流。每席最多两条 SSE，慢连接有界断开并可补读；心跳只是连接存活，不续行动时间。反向代理必须关闭 SSE 缓冲，读取超时需超过心跳间隔。

原 `GET /observation?after=...` 继续可用。不要求模型自行轮询：运行器负责 SSE、保存尚未交给决策者的 updates、串行唤醒、提交动作与恢复原回执。SSE 是通知及交付方式，不是另一个状态来源。

动作继续绑定 `{observationId,decisionToken,action,decisionSummary?}`。运行器将凭证字段排除在模型输入之外，自己绑定和发送。网络结果不明确时重用持久保存的同一幂等键和原命令；恢复回执之前不启动新的动作。过期观察、非法动作、重连和日志上传均不延长期限。

### 固定期限

- 新房间开局和新 HTTP 建局启用 `required-window-v1`，服务端写入策略事件和持久截止时间。历史 episode 不追溯添加。
- 每个**必需行动窗口 60 秒**，整局运行上限 60 分钟。后台每秒扫描，未连接任何玩家也会超时；动作提交时再次在事务内检查截止，恰好到期也拒绝。
- 花火：当前玩家每轮 60 秒。The Game：同一玩家的多张出牌及结束回合共用同一窗口，聊天不续时。
- Take Time：讨论/看牌准备阶段共用窗口；放牌各一个窗口。Sky Team：讨论、重掷提交、放置分别由适配器定义；可选消息不能续时。
- Crew、Bomb Busters：区分必须选择/出牌的席位与能发可选信号的席位。The Gang：一轮取筹码共用 60 秒。The Mind：集中准备与团队下一次推进使用窗口，`any` 不表示每个人都必须出牌；这是公开声明的评测时间约束，不是官方实体桌游规则。
- Magic Maze：开场 briefing 60 秒；正式进行及讨论使用游戏官方时钟，不能强迫每位玩家额外每分钟移动。规则时钟由后台推进，不再依赖有人读取。
- 到期保存 `status=truncated`、`endReason=decision_timeout`（或 episode_timeout），不伪造官方失利；终局后的轨迹补传仍可用。官方时钟与运行期限同时存在时，先推进到较早期限，官方结束在同一时间点优先。

## 无界面模型 Agent

每个席位创建私有配置文件（不提交 Git）：

```json
{
  "invitation": "组织者复制的完整邀请链接",
  "name": "模型 A",
  "mode": "model",
  "baseUrl": "https://provider.example/v1",
  "model": "提供方的模型名称",
  "apiKeyEnv": "MODEL_API_KEY",
  "directory": "./artifacts/player-a",
  "autoReady": true
}
```

在进程环境中设置 `MODEL_API_KEY` 后运行 `pnpm agent path/to/private-config.json`。每席使用独立目录和进程。运行器自动加入并确认最新 roster，房主/管理端开始后自动处理推送。中断后用同一配置/目录恢复，不能更换座位 token 来覆盖目录。

最小 Agent 使用 [Chat Completions function calling](https://developers.openai.com/api/docs/guides/function-calling)，不是对所有提供方的兼容认证。需支持 `tools`、`tool_choice`、`parallel_tool_calls`；每次决策至多两次格式纠正请求。规则拒绝不会产生新的棋盘事件，因此运行器会把错误交回决策者，在同一窗口内最多追加一次纠正决策；不延长期限。完整历史按实际内容发送，没有默默嵌入最优策略或代打；响应错误不会随机出牌。等待不会续时，必需窗口到期由服务器截断。

实际 JSON 请求/响应（包括提供方实际返回的 reasoning 字段）、执行的工具调用/结果先写本机 durable outbox，再独立上传服务端 messages。认证头不进入消息记录。没有返回的 reasoning 不补造，当前 completion 保守标为 partial；外部框架内部、非 JSON 网络错误原文及未捕获的 provider 内部均不宣称完整。

本机待发记录与完整模型历史可能含私有手牌；仅交给人工审计者，不能共享给同局其他 Agent。`messages.jsonl` 与数据库不应提交 Git，服务端不会把消息审计接口暴露给其他席位。

## 外部 Agent / 子智能体

配置 `mode: "external"`（或省略 mode），其他邀请、目录、名字字段相同。以 JSONL 标准输入/输出接入：

```text
运行器 stdout: {"type":"decision","id":"本次请求id","context":{"rules":...,"observation":...}}
外部宿主 stdin: {"id":"相同请求id","action":{"type":"hint","target":"p2","kind":"value","value":1}}
或 stdin:      {"id":"相同请求id","wait":true}
```

其他 stdout 行是 status/warning，不是模型消息。这里的宿主负责把 decision 发给一个独立子智能体并回传动作；不自动共享队友信息，也不自动取得子智能体内部 thinking。运行器保存实际工具调用；外部宿主的完整模型 messages 仍需按 [消息接口](agent-messages.md) / [附件接口](agent-artifacts.md) 单独真实采集和上传，不把回显 context 冒称为宿主的完整模型请求。

## 扩容边界

当前仍是一个权威进程与 SQLite，一个同步事务处理一次有界动作，多局共享服务。**用户确认的目标为每局一个独立 Node 子进程，负责该局全部玩家，尚未实现。** Nginx 反向代理到主进程，由主进程通过 IPC 调度专属 worker，并集中持久化和交付 SSE；本地模式可直接访问 Node 服务。详见 [对局处理单元与 worker 设计](agent-session-design.md#11-对局处理单元worker-与扩容)。改造须保留持久回执、原始截止时间和信息隔离；游戏结束释放进程，审计记录和赛后附件补传继续可用。
