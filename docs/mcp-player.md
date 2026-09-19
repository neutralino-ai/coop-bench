# MCP 参赛桥接与长轮询客户端

本实现包含真正的 MCP stdio 服务，使用官方 `@modelcontextprotocol/sdk`。它在本机运行，将三个 MCP 工具转发到同一个后端席位 API。Windows 和 macOS 使用相同 Node.js 24 程序；凭证只留在本机配置和 HTTP Authorization 请求头中。

## 1. 给一个 Agent 配一个席位

组织者先用管理端创建对局，给参赛者本席的配置。每个席位使用独立目录，不共享审计账户或其他玩家配置。创建本机私有 `seat.json`：

```json
{
  "apiUrl": "https://coop.neutrinophysics.cn:34936/api/v1",
  "episodeId": "替换为已创建的对局 ID",
  "seatTokenEnv": "COOP_SEAT_TOKEN",
  "directory": "/absolute/path/to/private-player-data"
}
```

`directory` 在 Windows 使用 `C:/...`，在 macOS 使用 `/Users/...`。令牌可以由宿主设置 `COOP_SEAT_TOKEN`，也可以写入私有配置的 `seatToken` 字段；不要把真实配置加入 Git。`apiUrl` 也接受管理端导出的 `baseUrl` 字段。**云端 0.9 协议现已部署在 `34936`；原 `34935` 保留给现有测试。** 使用新服务创建的对局和席位配置，两边不共享对局或席位令牌。详见 [并行部署与客户端切换](cloud-v09-parallel.md)。

在支持 MCP 的 Agent 宿主中添加本地 stdio 服务，配置等价于：

```json
{
  "mcpServers": {
    "coop-player": {
      "command": "node",
      "args": ["/absolute/path/to/coop-bench/scripts/mcp-play.mjs", "/absolute/path/to/seat.json"]
    }
  }
}
```

不同宿主的配置入口和环境变量继承不同，按对应宿主设置并实际检查工具列表。网址本身不会自动变成模型工具；安装后应能看到 `rules`、`wait`、`act`。

## 2. 只有三个游戏工具

| 工具 | 参数 | 返回/约束 |
| --- | --- | --- |
| `rules` | 无 | 当前对局的规则、场景与动作范围 |
| `wait` | `cursor?`, `timeoutMs?` | 本席观察、更新历史、`nextCursor`、`hasMore`、`decisionToken`、服务端固定截止时间；默认等待 25 秒，最多 50 秒 |
| `act` | `requestId`, `decisionToken`, `action`, `decisionSummary?` | 一个合法游戏动作的裁决；游戏允许的讨论、提示也是动作，不是额外私聊 |

循环：读规则 → `wait` → 如果 `hasMore` 为真继续读取下一页 → 根据完整可见历史决定 → `act` → 再 `wait`，直到对局结束。

- `nextCursor` 表示已经交付的历史，不等于当前快照的最高版本；不能跳过未下载页。
- `wait`、断线重连和无效动作都不延长服务器的 60 秒行动窗口。
- 每个新的动作意图使用一个新的 `requestId`。网络失败后，使用**相同的编号和原始参数**重试；本地 SQLite 保存完整请求，重启后也不重新生成编号。
- 若一个 POST 的结果未知，桥接拒绝提交另一个动作，直到原请求重试得到确定回执。重启后 `wait.pendingAction` 返回原始重试参数，宿主不必依赖已经丢失的内存。
- `decisionToken` 是当前决策窗口的标识，不是席位登录令牌。模型不需要知道 `seatToken`。
- 取消 `wait` 会取消 HTTP 请求，不推进本地游标。收到结束状态后宿主应停止循环。

MCP 不负责唤醒已经退出的模型进程。持续调用和退出策略由 Agent 宿主或运行器负责。

## 3. 不使用 MCP 也能参赛

`client/seat-session.mjs` 提供同样的 `rules / wait / act`，用于已分配席位。它调用：

```text
GET  /api/v1/episodes/:id/rules
GET  /api/v1/episodes/:id/wait?after=0&timeoutMs=25000
POST /api/v1/episodes/:id/actions
```

所有请求都使用本席 Bearer 凭证。POST 的 `Idempotency-Key` 是请求编号；payload 保留现有 `observationId + decisionToken + action` 契约。

使用邀请链接的完整运行器仍是 `scripts/player.mjs`，桌面 Player 使用同一个 `PlayerRuntime`。观察传输默认为长轮询；旧服务缺少 `/wait`（404/405）时自动退回已有 SSE。也可显式配置 `transport: "long-poll"` 或 `"sse"`。运行器在调用模型前合并尚未实际送入模型的全部更新页。

## 4. 轨迹与 reasoning 的边界

- 最小模型运行器记录实际模型请求、实际响应及 provider 返回的 reasoning；网络故障记录为传输失败，非 JSON 错误页面保留原文，不能补造模型输出。
- MCP 桥接记录它实际收到的工具请求与结果，持久存入 `mcp-messages.jsonl` 并通过已有 `/messages` 接口上传。SQLite 请求日志和 JSONL 都位于本席私有目录。
- **MCP 桥接看不到 Agent 宿主内部的完整 messages 或 reasoning。**宿主应导出比赛中实际记录的 transcript，并通过 [附件上传命令](agent-artifacts.md#一条命令上传完整文件)补交，包含动作的 `requestId` 以关联。每席 `/messages` 当前是单一有序流，不能让另一个记录器也从 sequence=0 抢写；如需实时混合上传，必须由同一运行器统一编号。界面不能把只有工具记录的局标为完整模型轨迹。
- 上传失败保留本地 outbox，重启同一桥接目录后继续补传，不因网络故障删除记录。

## 5. 验证

```sh
node --test test/player-protocol.test.ts test/player-runtime.test.ts
```

测试覆盖真实子进程 stdio MCP 初始化与调用、席位凭证不进入工具 schema/结果、分页不跳过历史、丢失回执后跨重启复用原始请求、取消等待、模型错误记录，以及完整合成花火运行。合成测试不代表真实模型分数，也不等同于操作系统级防作弊隔离。
