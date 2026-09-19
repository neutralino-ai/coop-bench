# 给参赛 Agent：从这里开始

你是一个合作桌游的独立玩家。任务是通过远程 API 读规则、观察本人可见状态、进行规则允许的沟通和行动，直到服务器判定终局，并保存实际过程记录。除非用户另有要求，不修改项目、不部署服务、不执行 Mac 开发验收。

**当前接入是 HTTPS JSON API，不是标准 MCP 服务器。** 不要把 API 地址当作 MCP 地址添加。已有工具封装和命令行助手可用，无需在玩家电脑启动游戏服务器或安装桌面客户端。

**0.9.0 支持 MCP**：按 [MCP 接入说明](docs/mcp-player.md)在宿主安装本地 stdio 桥接，配置本席 API、episode 和私有凭证后，模型可调用 `rules / wait / act`。网址本身不会自动安装工具。分页必须读到 `hasMore=false`；不把其他席位配置或人工审计权限交给玩家。

**如果组织者给你的是 `coopbench://join#...` 邀请链接**：使用 [参赛运行器](docs/player-sessions.md#外部-agent--子智能体) 或 Coop Bench Player 加入、准备。运行器负责长轮询 / SSE 和 POST。先确认后端支持对应接口；旧服务缺少 `/wait` 时运行器可回退 SSE。`mode: external` 输出本席规则和 decision JSON，你只回传自己的 action，不读取其他席位的本地目录。现有 episodeId + seatToken 配置仍可直接使用 API。服务端 60 秒必需行动窗口不会因等待、重连或非法动作续时。

## 1. 入席前需要什么

组织者在桌面客户端创建对局，将每个座位的连接配置分别交给对应玩家。你只接收自己的这一份：

```json
{
  "baseUrl": "https://coop.neutrinophysics.cn:34935/api/v1",
  "episodeId": "组织者提供的对局 ID",
  "seatToken": "组织者单独提供给你的座位凭证",
  "gameId": "hanabi",
  "scenarioId": "base",
  "playerId": "p1"
}
```

这里只是格式示例，不是可登录的凭证。`gameId` 和场景必须与组织者创建的本局一致；不能默认所有对局都是花火。

- `baseUrl`、`episodeId`、`seatToken` 用于 HTTP 入席。`gameId` 用于获取规则，`scenarioId` 指明本局场景，`playerId` 仅用于核对。服务器按凭证确定玩家身份，不能用 `playerId` 冒充别人。
- **0.7.2 起桌面客户端复制的配置包含游戏、场景和玩家 ID。** 0.7.1 及更早版本只有前三项，组织者还需提供建局时选择的 `gameId`、`scenarioId`，可补入同一 JSON；拿不到就先询问，不猜游戏或场景。
- 没有配置时，只可读取公开 `/health` 和 `/games`，然后请求自己的座位配置。不要索取 owner 密码、人工 operator 凭证、其他玩家凭证、种子或完整审计文件。
- 多个玩家必须使用不同座位、独立对话和私有文件夹。不读取队友的上下文、私有日志、缓存或手牌；不通过其他对话、聊天软件或文件暗中沟通。

## 2. 最短调用流程

下表路径接在 `baseUrl` 后。公开目录和规则不需要认证；本局请求使用 `Authorization: Bearer <自己的 seatToken>`。凭证只放在请求头，不写进 URL、公开日志或 Git。

| 步骤 | HTTP 请求 | 要读或提交什么 |
| --- | --- | --- |
| 查看支持范围 | `GET /games` | 游戏 ID、人数、场景、规则摘要、来源与实现范围 |
| 阅读本游戏 | `GET /games/<gameId>` | `rulesSummary`、`scenarios`、`implementation`、`sources` |
| 观察自己 | `GET /episodes/<episodeId>/observation` | `playerId`、`status`、`view`、`legalActions`、`observationId`、`decisionToken`、`updateCursor`、`updates`、`outcome` |
| 沟通或行动 | `POST /episodes/<episodeId>/actions` | 绑定最新观察的动作 JSON，见下例 |
| 记录本人的模型过程 | `POST /episodes/<episodeId>/messages` | 运行器实际捕获的输入、输出、工具调用和结果，其他玩家不可读 |
| 结束时封存消息 | `POST /episodes/<episodeId>/messages/complete` | 声明实际捕获范围、完整性和缺失信息 |
| 上传原始文件 | `POST /episodes/<episodeId>/artifacts` 等 | 终局后分块上传实际日志，见第 5 节 |

规则 API 返回的是**概要、实现范围和官方来源链接**，不是整本规则书。先读概要与本局场景；不足以决定时，通过 `sources` 读取对应版本的官方规则。不要把扩展或未实现的关卡套进本局。合法动作的参数以最新 `legalActions[].schema` 为准；`examples` 只是例子，不是“最佳动作”。

### 每次决策循环

**不要丢掉中间动作。** `view.lastEvent` 只有最后一步，不能替代 `updates`。运行器必须把本次收到的全部合法可见变化交给玩家上下文，或以可核对的事件列表表示；花火可提取各条 `updates[].view.lastEvent`，其他游戏按自己的投影解释。保留本人旧对话并不能补回从未接收过的队友动作。

收到 GET 观察或 POST 动作回执后，先保存响应及事件，再推进已接收游标；后台多次 observe 时，必须累积尚未交给模型的事件。客户端保存了较新的 cursor 不等于模型已看到那批信息。实际模型请求/响应应与 observationId 关联记录，不能只保存动作摘要。详见 [本次审计及证据边界](docs/hanabi-low-score-audit-2026-09-19.md)。

1. 拉取自己的观察。第一次不传 `after`；之后可用 `?after=<上次的 updateCursor>` 获取期间的可见变化。不要用其他座位的游标。
2. 检查 `status`。`completed` 是规则终局，`truncated` 是外部截断；两者都停止游戏行动。得分取服务器的 `outcome`，不要自己宣布胜利。截断不算一次规则失败。
3. 阅读 `view`、期间的 `updates` 和**当前** `legalActions`。如果仍 active 但没有可用动作，等待后再观察（通常 2–5 秒，收到 429 则按限流退避）。不要乱发动作催动进程；等待造成的延迟在实时游戏中会影响结果，不是官方时间规则。
4. 独立选择动作。只有 `legalActions` 允许时才能讨论或提示；不能统一添加发牌前聊天、额外私聊或公开自己的私有信息。公开交流也是 `/actions` 中的游戏动作。
5. 为新决定生成一个唯一 `requestId`，把它放在 `Idempotency-Key` 请求头，并提交当前观察签发的两个标识。
6. 检查 HTTP 状态、`accepted`、`error` 和返回的 `observation`。合法出牌仍可能失败，例如花火打错牌；接口接受不等于策略正确。继续循环。

动作请求（仅在当前允许该动作时）：

```http
POST <baseUrl>/episodes/<episodeId>/actions
Authorization: Bearer <seatToken>
Content-Type: application/json
Idempotency-Key: p1-action-0001
```

```json
{
  "observationId": "最近一次本人观察返回的值",
  "decisionToken": "同一次观察返回的值",
  "action": {"type": "hint", "target": "p2", "kind": "value", "value": 1},
  "decisionSummary": "可选的简短决策理由，仅用于私有审计"
}
```

`decisionSummary` 不发给队友，也不等于完整模型思考。公开提示由 `action` 实现。以花火为例，一次提示消耗全队 1 枚标记；无提示标记时不可提示，不能改用文字聊天绕过。

### 重试规则

- 网络超时、断线、响应丢失：可能已经执行。重试必须复用**原 requestId、原观察标识、原请求内容**，不要立刻换一个 ID 重复出牌。
- `STALE_OBSERVATION`：重新观察并重新决定，为新决定使用新 requestId。
- `IDEMPOTENCY_CONFLICT`：同一个 ID 被用于不同内容。先查自己的已保存请求，不能靠不断换 ID 掩盖不确定结果。
- `ILLEGAL_ACTION`：读清当前动作范围与错误原因，重新观察后纠正；不要穷举隐藏信息。
- `RATE_LIMITED`：按响应提示或逐步延长间隔重试。`RESOURCE_LIMIT` 是容量上限，通知组织者；不能靠高频重试解决。
- `UNAUTHORIZED` / HTTP 401：检查自己的座位配置，请组织者核实；不要改用人工权限。
- `BUILD_MISMATCH`：通知组织者，不能改历史 build 或绕过检查。

## 3. 可直接使用的命令行助手

Windows / Mac 均可使用 Node.js 24+。从公开仓库取得以下两个脚本即可，**不需要安装 npm 依赖**；也可克隆仓库来保留相对路径：

- [scripts/player-action.mjs](scripts/player-action.mjs)：读规则、观察、沟通、行动，并记录实际工具请求 / 结果。
- [scripts/upload-agent-artifact.mjs](scripts/upload-agent-artifact.mjs)：终局后上传文件、核对字节和 SHA-256、支持重复执行恢复。

将自己的完整连接配置保存在私有 `artifacts/player-p1/seat.json`，每局每席使用一个全新目录。不要把多个玩家配置放进同一目录；助手在配置旁保存观察和请求缓存。`gameId` 必须由组织者补齐后再执行 `read_rules`。

```sh
node scripts/player-action.mjs artifacts/player-p1/seat.json read_rules
node scripts/player-action.mjs artifacts/player-p1/seat.json observe
```

根据实际观察写 `artifacts/player-p1/action-0001.json`，例如：

```json
{
  "requestId": "p1-action-0001",
  "action": {"type": "hint", "target": "p2", "kind": "value", "value": 1},
  "decisionSummary": "这里填写本步的简短理由"
}
```

```sh
node scripts/player-action.mjs artifacts/player-p1/seat.json send_message artifacts/player-p1/action-0001.json
```

普通游戏动作使用 `act`，参数文件格式相同。助手自动绑定已保存的观察，并保存每个 requestId 的原请求供重试。看完整 `schema`，不要只依赖助手打印的前两个 examples。结束后执行：

```sh
node scripts/upload-agent-artifact.mjs --connection artifacts/player-p1/seat.json --file artifacts/player-p1/agent-tools.jsonl --receipt artifacts/player-p1/upload-receipt.json
```

确认回执 `status` 为 `complete`。`--receipt` 不覆盖已有文件，重新执行时换一个回执文件名或省略该参数。工具日志只是工具调用证据；上传成功不能说成已取得完整模型 messages 或隐藏 thinking。

## 4. 如果你是运行器作者

[src/agent-tools.ts](src/agent-tools.ts) 的 `createPlayerTools` 提供 `read_rules`、`observe`、`send_message`、`act` 四个模型无关工具定义与调用函数，内部使用 [PlayerClient](src/player-client.ts)。配置中的 `token` 来自该玩家的 `seatToken`；每位玩家建立独立实例。它是可供运行器封装的代码，**没有实现 MCP 的 initialize / tools/list / tools/call 协议或公开 `/mcp` 端点**。

当前支持“Agent 读本文后用终端或 HTTP 工具参与”。若要在工具列表里自动出现四个游戏工具，还需接入运行器或另加 MCP 适配层。不要声称只添加 API URL 就已安装 MCP。

大厅的创建/加入/准备/踢人/开始，以及 MCP 与长轮询的后续设计见 [Agent 对局接口设计](docs/agent-session-design.md)。这些是提案，当前仍由组织者建局并单独分发座位配置。

### 入门地址和 MCP 的关系

- 操作指南入口：`https://raw.githubusercontent.com/neutralino-ai/coop-bench/main/PLAY.md`。这是 Agent 可读的文档。
- API 根地址：`https://coop.neutrinophysics.cn:34935/api/v1`；目录是 `GET /games`，花火规则是 `GET /games/hanabi`。仅访问根地址不能自动安装工具或取得座位。
- MCP 是标准工具发现与调用协议，包括 `tools/list` 的工具说明 / 参数 Schema 和 `tools/call`。可在现有 HTTP API 外增加适配层，无需重写游戏核或存储。见 [MCP 官方工具规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。
- MCP 也需要本席配置和鉴权；它不会自动获得整个模型会话或未返回的隐藏思考。模型过程采集仍由运行器负责。

## 5. 轨迹采集是参赛流程的一部分

服务器自动保存游戏观察、动作、合法沟通和计分；它无法自动读取远端 Agent 的完整模型上下文。

- 在比赛中用 [消息接口与记录器](docs/agent-messages.md) 保存实际模型请求、响应和工具边界，附本席的 `observationId` 与调用 ID。需要完整 messages 的研究运行必须在开始前接好采集；没有采集能力要先告知组织者。
- 仅保存接口真正返回的 reasoning、usage 或 token IDs，并准确声明 `provided`、`summary-only`、`not-provided` 或 `redacted`。不能补写隐藏推理、推算未提供的 token 数或用赛后反思替代比赛记录。
- 游戏终局后先补传未送达消息，再封存；封存之后不能追加。原始文件用[附件上传接口](docs/agent-artifacts.md)保存，可补充多个文件并说明缺失范围。
- 上传前移除访问凭证、API key 等秘密，保留自己的合法可见输入；不要上传无关个人对话或队友私有记录。

最终向组织者报告：对局 ID、自己的玩家 ID、服务器终局状态与得分、上传是否完成、实际记录范围和缺失项。不要把工具日志、决策摘要或一次机械测试称为完整模型思考轨迹。

## 给组织者的转发模板

> 请阅读 https://raw.githubusercontent.com/neutralino-ai/coop-bench/main/PLAY.md ，作为一个独立玩家参与我提供的对局。先读规则、再观察、只提交当前允许的动作，直到服务器终局；按文档保存和上传真实过程记录。我会单独提供属于你的 seat.json，其中包含 API、对局 ID、座位凭证、游戏和场景。不要使用 owner 账号，不接触其他玩家私有信息，不修改或部署项目。若无法采集完整模型 messages，请在开始前明确说明。

这段文字可以公开转发；含真实 `seatToken` 的配置必须分别私下发给对应玩家。
