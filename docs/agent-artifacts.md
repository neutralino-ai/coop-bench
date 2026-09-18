# 长期保存与 Agent 原始附件

**比赛过程的模型 messages 请优先使用 [逐条消息采集接口](agent-messages.md)。** 它在每次模型调用时记录实际请求、响应和工具结果，赛后只做封存声明。本文的附件接口用于大文件、原始 JSONL 和补充材料；上传发生在赛后不意味着内容是赛后反思。

服务器保存两类证据，二者不能互相替代：

1. **服务器游戏轨迹**：经过 API 的公开交流、动作、观察、拒绝、状态变化、终局和审阅记录，自动写入 SQLite。
2. **Agent 原始运行记录**：完整输入消息、模型实际输出、工具调用及结果、客户端日志，以及模型接口实际返回的 reasoning 文本、token IDs、token 用量。服务器看不到客户端没有提交的部分，需要客户端赛后上传。

上传内容一律标记 `client-supplied-unverified`。服务器校验字节完整性、提交身份和所属对局；不会声称上传内容是可信的模型内部思维，也不从摘要或 token 数量重建推理文本。游戏奖励仍由规则引擎判定，附件不会修改胜负或自动成为 SFT 专家数据。

## 保存多久

对局、交流、观察及附件**不设置自动过期或自动删除**。服务重启、应用升级、个人网页凭据到期，都不会清理这些记录；历史构建的终局也可继续上传附件。

存储不是无限的。达到配额时返回明确错误，保留已有记录，停止接收超额的新写入。未完成的上传也会保留，供原玩家重试续传。不会为给新记录腾位置而自动删掉旧局。运维人员可以扩容；不要把错误响应当成保存成功。

附件初始预算：单个文件 64 MiB、每局每个玩家 16 个、全库预留总量 8 GiB，32 KiB 分块。数据库页、索引、WAL 和备份还需要额外空间。普通游戏轨迹另有既有预算，实际配置与使用量通过人工身份接口的 retention 信息查看。

`scripts/backup-server.mjs` 使用 SQLite 在线一致性备份，包含所有历史表和附件 BLOB，也包含已经提交到 WAL 的内容。云端定时器每天保存一份完整快照，并保留上一次完整快照。**这两个备份代次不是轨迹保留期限**：实时数据库和每份新完整备份均含全部未被管理员手动移除的历史。本机磁盘损坏时同机备份也可能丢失；本次不声称已有异机灾备。

## 身份与跨地域接入

人类在桌面客户端使用用户名 / 密码或组织者发放的个人凭据登录。现有 `owner` 与四位 `tester-*` 都是 `operator`，可创建、中止、审阅和导出团队共享对局；`auditor` 只审阅终局。个人凭据不是玩家身份。

创建对局返回各玩家独立 `seatToken`。把同一 `episodeId` 和各自不同的 token 分发给不同机器上的 Agent；它们均访问 `https://coop.neutrinophysics.cn:34935/api/v1`。完整参赛配置和规则获取见 [PLAY.md](../PLAY.md)。每个 Agent 只能观察和操作自己的座位，赛后只能上传和恢复本人的附件。游戏沟通也经 `/actions`，因此会进入服务器轨迹，而不是依赖 Agent 在本机之间直接聊天。

Take Time 的牌背、自由讨论、个人看牌后禁言与并发重试见 [沟通接口与官方规则](take-time-communication.md)。

## 一条命令上传完整文件

私有玩家连接文件 `seat.json`：

```json
{
  "baseUrl": "https://coop.neutrinophysics.cn:34935/api/v1",
  "episodeId": "由创建接口返回的对局 ID",
  "seatToken": "该玩家自己的凭据"
}
```

在项目目录运行（Node 24，Windows/macOS/Linux）：

```text
node scripts/upload-agent-artifact.mjs --connection seat.json --file agent-trace.jsonl --metadata trace-metadata.json --receipt upload-receipt.json
```

元数据示例：如果该文件只含行为记录与明确写出的决策摘要：

```json
{
  "reasoningAvailability": "summary-only",
  "provider": "由运行器填写的实际来源",
  "model": "由运行器填写的实际模型"
}
```

如果模型确实返回了 reasoning 文本或 token IDs，把实际返回内容原样放入文件，并声明 `reasoningAvailability: "provided"`。可附 `tokenCounts` 对象，键如 `input`、`output`、`reasoning`、`total`；填实际计数。未知的字段省略，不能用 0 冒充未知。只拿到计数但没有 reasoning 内容时，使用 `not-provided`；主动删除了相应内容时使用 `redacted`。

命令自动计算 SHA-256、建立 manifest、按服务端返回的缺块列表续传、完成散列核对。重复执行相同文件和元数据时复用同一上传，不覆盖原件。失败时退出码非零；保留原文件后可继续执行。收据只包含附件元数据，不含玩家 token。改变文件内容会生成新的附件。

大文件可拆成多个真实文件，每个都有自己的散列与编号；不要为了通过校验而截断日志后仍声称完整。上传前在运行器的导出层移除 `Authorization`、模型 API key 等凭据，并在日志头记录删去哪些凭据字段。服务器不会悄悄改写已上传字节。

## HTTP 协议

以下省略 `/api/v1`；全部使用 `Authorization: Bearer <该座位 token>`，JSON 请求体保持在 64 KiB 内。

### 1. 对局终局后建立 manifest

`POST /episodes/:episodeId/artifacts`，`Idempotency-Key` 固定标识这份文件与元数据：

```json
{
  "name": "agent-trace.jsonl",
  "kind": "agent-trace",
  "mediaType": "application/x-ndjson",
  "byteLength": 12345,
  "sha256": "文件字节的64位小写十六进制SHA256",
  "reasoningAvailability": "not-provided"
}
```

`kind` 也可为 `attachment`。`byteLength` 是实际 UTF-8/二进制字节长度，不是字符数。返回单个 artifact，含 `id`、`playerId`、`status`、`chunkSize`、`chunkCount`、`receivedChunks`、`missingChunks`。一经创建不能换内容；同 key 不同 manifest 会被拒绝。

### 2. 上传缺失分块

`POST /episodes/:episodeId/artifacts/:artifactId/chunks`：

```json
{"index":0,"dataBase64":"这一块实际字节的Base64"}
```

下标从 0 开始。每块 32768 字节，最后一块按文件实际长度；重复同一块的相同字节是幂等操作，不同字节不会覆盖。网络超时可重试原块。`GET /episodes/:episodeId/artifacts` 返回本人的上传及缺块状态，便于跨进程恢复。

### 3. 封存

`POST /episodes/:episodeId/artifacts/:artifactId/complete`，JSON `{}`。所有块、总尺寸和 SHA-256 均匹配才返回 `status: "complete"`。否则保持未完成，不向审计者提供伪完整下载。空文件也需要正确的空内容散列。

### 4. 审阅和下载

人类凭据：

- `GET /rollouts/:episodeId/artifacts`：列元数据，不自动下载所有大文件。
- `GET /rollouts/:episodeId/artifacts/:artifactId/content`：下载已经完整封存的原始字节，强制附件响应，不在网页执行 HTML。

原玩家可用自己的 seat token 访问 `/episodes/:episodeId/artifacts/:artifactId/content`。其他玩家不能下载它。访问控制包含历史对局，不能通过换 API 前缀绕过。

## 可选 JSONL 内容约定

文件内容本身允许任意格式。研究运行器可采用每行一个事件，包含：

- `session`：`episodeId`、`playerId`、实际模型、provider、运行器版本、起止时间、日志完整性与脱敏说明。
- `model_request`：实际发给模型的输入消息及允许的工具定义。
- `model_response`：实际输出内容、提供商返回的 reasoning/token IDs/usage（缺失则省略并标记）。
- `tool_call` / `tool_result`：API 路径、脱敏请求、结果、`observationId`、幂等请求 ID、时间，用来关联服务器事件。
- `reflection`：赛后复盘，和行动时的模型输出分开。
- `session_end`：正常完成或截断、是否遗漏片段、最终上传文件清单。

RLVR 验证以服务端规则与可重放事件为准。SFT 整理时按玩家过滤实际可见输入，保留模型来源与失败标签，不能把别人的隐藏牌、终局揭晓或赛后反思放回行动时输入。
