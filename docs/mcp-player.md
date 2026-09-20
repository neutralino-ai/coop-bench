# MCP 参赛接口

当前交付的是本地 STDIO MCP 桥接。游戏服务器的 /api/v1 是 HTTPS JSON API；远程 /mcp/play 和 /mcp/admin 是待实现设计，不能将 API URL 当成 MCP URL 配置。

准备 Node24、安装仓库依赖，无需构建桌面客户端。组织者给本席 seat.json：

```json
{"apiUrl":"https://coop.neutrinophysics.cn:34936/api/v1","episodeId":"organizer-provided","seatTokenEnv":"COOP_SEAT_TOKEN","directory":"/absolute/path/to/private-player-data"}
```

Windows 路径使用 C:/...。也可在私有文件使用 seatToken 字段；不提交 Git，每席独立目录。组织者导出的 baseUrl 是 apiUrl 的兼容别名。

宿主启动命令：

```sh
node /absolute/path/to/coop-bench/scripts/mcp-play.mjs /absolute/path/to/seat.json
```

Codex CLI 可配置：

```sh
codex mcp add coop-player -- node /absolute/path/to/coop-bench/scripts/mcp-play.mjs /absolute/path/to/seat.json
```

宿主必须可读取配置与环境变量。接入后检查实际工具列表：rules、wait、act。安装环境先完成，再创建立即发牌的对局。

- rules()：当前游戏的规则、场景和动作范围。
- wait({cursor?,timeoutMs?})：默认25秒、最长50秒；返回本席观察及nextCursor/hasMore/decisionToken/deadline。分页读完再行动。
- act({requestId,decisionToken,action,decisionSummary?})：提交动作，重试复用相同编号和原参数。

桥接持久记录工具流和未确认请求，网络失败保留outbox。MCP不自动驱动已退出的模型，也看不到宿主完整messages/隐藏思考。宿主需要持续wait→act至终局，真实transcript另按附件接口上传。

## MCP、Skill 和说明文档

MCP是发现与调用工具/读取上下文的协议；instructions和工具描述是说明文字。Skill是由宿主安装/加载的工作指南，不会因连接MCP自动成为一个Skill。PLAY.md是便于人阅读、直接API客户端入门的独立文档；MCP玩家不应必须另读它才知道基本循环。

拟议的 /mcp/play 与 /mcp/admin 是不同权限的工具入口，不是两个Skill。玩家入口只允许本席观察/行动；管理入口用于组织者建局与审计。路径本身不构成安全边界，服务端必须分别校验凭证和每次操作权限。
