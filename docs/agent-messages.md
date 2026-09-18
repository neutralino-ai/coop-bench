# 比赛中的模型 messages 与 reasoning

保存每次决定发生时运行器实际发送、实际收到的完整模型请求与响应，以及相连的工具调用和结果。数据在模型调用边界采集，赛后仅核对、补传和封存。

游戏服务器能自动记录自己的规则、观察、交流和动作，但无法看到另一台机器上尚未上传的模型上下文。各地 Agent 用自己的座位凭据提交消息。这是私有审计记录，不广播给队友，不改变观察版本、回合、时钟或胜负。游戏内沟通仍走 `/actions`，遵守各游戏规则。

## 分别保存的证据

| 数据 | 记录方式与边界 |
| --- | --- |
| 实际模型请求 | 原始 JSON 请求体，包括本次真正使用的 messages/input、工具定义和生成参数；保留调用 ID，不能事后用终局信息重建 |
| 实际模型响应 | 原始 JSON 响应，包括 content、tool_calls、停止原因、错误或不完整状态；流式运行器还应记录实际收到的 delta 顺序 |
| reasoning/thinking 原文 | 仅保存模型 API 实际返回的字段，保持供应商字段名，不从结果或胜负补写 |
| 推理摘要 | 标记 summary-only，不能称完整内部思考 |
| token 数量 | 保存原始 usage；reasoning_tokens=100 只代表数量，不提供这 100 个 token 的内容 |
| token IDs | 仅接口实际返回时保存；不能把文本重新分词冒充模型原始 token IDs |
| 加密 reasoning | 可原样保留用于供应商后续调用，审计端标为不可读 |
| 决策摘要、赛后反思 | 各自保存，不替代比赛中的消息记录 |

OpenAI 文档区分未公开的原始 reasoning tokens、可请求的 reasoning summary、usage 计数和不可读的 reasoning items。选择“支持 reasoning”的模型名称不足以证明能取得完整思考文本；接入时必须检查实际响应与字段含义。[官方说明](https://developers.openai.com/api/docs/guides/reasoning)

当前 Codex 子智能体工具接口不提供其内部隐藏思维全文。演示局 `9a40164c-3d95-4c79-9288-d8f62ec74f20` 的三份附件是工具请求/结果与显式决策摘要，缺少完整模型上下文、模型回复和 reasoning token IDs，不能事后补成完整轨迹。用户已选择后续接入可返回 reasoning 的模型 API；实际供应商、模型和连接配置尚待提供。

## HTTP 接口

以下省略 `/api/v1`。玩家使用自己的 `Authorization: Bearer <seatToken>`，不使用人类管理员凭据。不要把 HTTP 头或 API key 放进消息记录。

### 比赛中按顺序追加

`POST /episodes/:id/messages`：

```json
{
  "sequence": 0,
  "messageId": "call-001-input",
  "kind": "model-input",
  "clientAt": "2026-09-17T08:00:00Z",
  "requestId": "call-001",
  "message": {
    "role": "runner",
    "raw": {"messages": [{"role": "user", "content": "协议格式示例，实际应保存本次完整请求"}]}
  },
  "reasoningAvailability": "not-provided"
}
```

这是协议示例，不是真实玩家的思考。`message` 是带 `role` 的 JSON 对象，原始 provider 消息可直接放入；完整请求/响应也可保存在 `message.raw`，不需把 content 数组或工具调用转换成文本。

可选外层字段：`kind`（model-input/model-output/tool-call/tool-result）、`model`、`provider`、`requestId`、`observationId`、`tokenUsage`、`reasoningAvailability`、`clientAt`。observationId 必须来自本座位实际观察；tokenUsage 保留供应商 JSON，最多 4 KiB，更大的 usage 留在原始内容中。原始内容还可记录环境动作 request ID，用于关联服务器回执。

每座位独立从 sequence=0 连续递增；messageId 必须稳定且唯一。同一序号和相同完整内容重试返回原记录，换内容或跳号返回 409。服务器加接收时间 serverReceivedAt；客户端时间不能证明上传发生在相应决定之前。

正文仍限制 64 KiB，单条消息 envelope 上限 48 KiB；单座位默认 10,000 条，全库消息默认 1 GiB 业务预算。长消息必须无损拆分或使用附件，不能悄悄截断。配额满时保留旧记录并拒绝新增。

### 恢复与读取

- 玩家：`GET /episodes/:id/messages?after=-1&limit=50`，只读自己；返回 messages、nextAfter、hasMore、completion、retention。
- 人类：`GET /rollouts/:id/messages` 返回各座位 messageCount、lastSequence、completion；加 `playerId=p1&after=-1&limit=50` 读取对应页。
- limit 为 1–100，服务器同时限制每页约 512 KiB 的消息 payload；以 hasMore 与 nextAfter 翻页，不能假定不足 limit 就是最后一页。
- operator 可审阅进行中的私有记录；auditor 仅可审阅终局。其他玩家不可读。

### 赛后封存

`POST /episodes/:id/messages/complete`，仅终局后调用：

```json
{
  "scope": "请运行器明确填写实际采集的范围",
  "completeness": "partial",
  "reasoningAvailability": "not-provided",
  "unavailable": ["本次运行器未取得的字段"]
}
```

completeness 是客户端对 scope 的声明，不是服务器对思考完整性或真实性的证明。覆盖声明范围才能用 complete；丢失消息、流式中断或导出缺失应写 partial。reasoningAvailability 为 provided/summary-only/not-provided/redacted。未知 token 数不得填写 0。

封存后不能追加或改写，相同请求可重试。先补齐本地 outbox，再封存；补充材料另上传不可变附件并说明关系。

## 在 Agent 运行器里采集

`scripts/agent-message-recorder.mjs` 是跨平台 Node 24 模块，不依赖某一家模型供应商。将它放在实际模型调用外层，而不是让模型在赛后凭记忆总结。下面是集成位置示意，`modelClient` 和请求体应由实际运行器提供：

```js
import { createAgentMessageRecorder } from './scripts/agent-message-recorder.mjs';
import { randomUUID } from 'node:crypto';

const scope = '本次运行实际模型请求、响应和工具调用；具体缺失见 unavailable';
const recorder = await createAgentMessageRecorder({
  ...seatConnection, // baseUrl、episodeId、seatToken；仅本座位
  outboxFile: './private/player-1-messages.jsonl',
  scope,
  model: configuredModel,
  provider: configuredProvider,
});
try {
  await recorder.resume(); // 先补齐上一次网络中断留下的记录
  const correlation = { requestId: randomUUID(), observationId: observation.observationId };
  await recorder.recordModelRequest(actualRequestBody, correlation);
  const actualResponse = await modelClient.create(actualRequestBody);
  await recorder.recordModelResponse(actualResponse, {
    ...correlation,
    reasoningAvailability: actualReasoningAvailability,
    ...(actualResponse.usage ? { tokenUsage: actualResponse.usage } : {}),
  });
  // 同样围绕实际工具执行调用 recordToolCall(...) / recordToolResult(...)。
  // 整局结束且补传成功后，才调用 recorder.seal(...) 声明实际采集范围。
} finally {
  await recorder.close();
}
```

这段示例没有调用任何预设模型，也不生成测试思考。`actualReasoningAvailability` 必须由实际响应的文档含义确定；只拿到 usage 时填 not-provided，有推理摘要填 summary-only。模型调用 ID 和环境动作 request ID 可以分别保存在原始记录中，界面外层 requestId 是通用关联字段。

每次 record 先同步复制 JSON、追加本地 JSONL 并 fsync，再按连续序号上传。请求失败会向调用者报错，不能继续当作完整样本。相同 outbox 可恢复重试，丢失响应也不会生成第二条记录。close 不替代上传成功确认；`status()` 可检查 pendingMessages 和 acknowledgedThrough。

单条原始 JSON 最多 64 MiB；保存 JSON 值，散列字节统一使用 `canonical-json/v1`（对象键排序），不声称保存 HTTP 原始字节。大于安全 envelope 或超过 JSON 结构限制时按每片 16 KiB 分块，附 logicalId、index/count、totalBytes、SHA-256，保留全部内容。前端对分片明确标注；从各页集齐同一 logicalId 的记录后，使用同模块 `reassembleCapture(envelopes)` 校验并还原，不能把一页分片当成完整消息。需要分享原始文件时，也可将本地完整 JSONL 用[附件上传命令](agent-artifacts.md)保存至服务器。

本地 JSONL 包含模型上下文和私有手牌，应放在玩家各自的私有目录；同一文件只允许一个运行器写入。遇到文件尾部损坏时保留原件并明确失败，不跳过损坏行后继续宣称完整。供应商原生对象应先取其真正的 JSON 响应体，不能直接传 SDK 类实例、函数或含 undefined 的对象。

## 保存与训练

消息与封存元数据进入同一 SQLite，重启、升级和完整备份均保留，不自动过期或删除。配额：`COOP_MAX_MESSAGE_BYTES`、`COOP_MAX_MESSAGES_PER_SEAT`、`COOP_MAX_MESSAGE_STORAGE_BYTES`；使用量在人类 `/identity` 中可见，独立于游戏和大文件预算。

所有上传标记 client-supplied-unverified：内容、模型身份、usage、客户端时间与完整性来自运行器。服务器验证座位归属、顺序、幂等性和数据完整性。审计页面以纯文本展示数据，不执行消息中的 HTML 或工具指令。

训练以环境判定奖励为准，用 observationId、动作 request ID、模型调用 ID 串联输入、输出、行动和结果。玩家只能使用当时可见信息。缺少 reasoning 的轨迹可用于动作研究，不能冒充完整思考 SFT 样本。当前完成采集、保存与审计基础设施，尚未提供自动 SFT 筛选、token mask 或 RL 优化器。
