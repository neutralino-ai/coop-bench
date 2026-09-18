# 《时序谜局》：讨论、牌背信息与异地玩家 API

核对日期：2026-09-17。依据发行商[官方中文规则书](https://cdn.svc.asmodee.net/production-libellud/uploads/2025/09/TT_RULES_CNS_WEB.pdf)，以下页码是纸面页码。

## 规则核对结果

- 第 2–3 页：牌库是太阳 1–12 和月亮 1–12，共 24 张。先混洗、发放 12 张，再进行讨论。三人各 4 张；四人各 3 张；双人各 6 张，分为 4 张手牌和 2 张预备牌。
- 第 4–5 页：讨论时正面仍不可查看，但**所有人都可以看到每位玩家的牌背颜色**，因此可以数出各人太阳牌和月亮牌的张数。这个信息不是只对自己开放。
- 讨论没有官方的轮流次序或 10/20 句限额。服务的请求限流和存储预算属于运行限制，不是桌游规则。
- 玩家自己选择 `look_hand`。看过自己牌面的玩家立即停止发言；还没有看的玩家可以继续讨论。所有人看过后进入放置阶段。双人游戏此时只查看 4 张手牌，预备的 2 张仍不能查看牌面。
- 第 6–7 页：放置阶段任何玩家可自愿打出第一张牌，随后按座位顺时针进行。默认暗置，明置是可选的团队额度。三人基础额度共 3 张，不要求前三张明置，也不要求用完额度。双方各打出 2 张后，双人游戏的预备牌加入各自手牌。
- 第 8–9 页：每格至少 1 张，六格总和从指针开始不递减，相等可以。当前实现仅第一章第一钟：第一格恰好 1 张太阳牌，第六格恰好 3 张任意颜色牌，且此钟没有每格总和 24 的上限。

## 之前为什么没有讨论

云端旧示范 `71a3d7ec-0e9d-4f1a-b821-ebf2ae98de6b` 用的是部署验收脚本 `scripts/validate-cloud-api.mjs`，由机械策略选择推进游戏的动作。`src/local-runner.ts` 的 `mechanicalPolicy` 明确跳过 `speak` 等自由文本动作，所以示范直接选择了 `look_hand`。

引擎当时已有 `speak`、自由讨论和公开 `cardBacks`；这局示范没有展示这些能力。它不能用于评价智能体沟通策略，也不能据此判定 LLM 的胜率。新审计界面应明确展示讨论消息，并在这类旧记录中显示“没有讨论”，不能补写没有发生过的对话。

## 实际可见字段

`GET /api/v1/episodes/{episodeId}/observation` 返回的 `view` 包含：

| 字段 | 含义 |
| --- | --- |
| `phase` | `discussion`、`playing` 或 `finished`；终止状态另见信封的 `status` |
| `discussion` | 当前已经接受的所有讨论消息，每条为 `{index, playerId, text}` |
| `lookedPlayerIds` | 已看牌且不能再参与讨论的玩家 |
| `cardBacks[playerId].hand` | 该玩家当前手中公开的 `solar` / `lunar` 牌背数组 |
| `cardBacks[playerId].reserve` | 双人游戏该玩家仍未加入手牌的预备牌牌背数组 |
| `cardColorCounts[playerId]` | `{hand:{solar,lunar}, reserve:{solar,lunar}}`，从当前公开牌背统计，2026-09-17 新增的便利用字段 |
| `hand` | 本人看牌前是 `null`；之后是本人当前手牌，包含出牌需要的 `id` |
| `placements` | 玩家、位置、牌背颜色、是否明置；其他人的暗置牌数值仍为 `null` |
| `ownPlacements` | 本人已打出的牌，允许本人回看 |

`cardColorCounts` 是**当前**张数，打牌后会减少，双人预备牌加入时会改变。审计初始张数必须读取初始 frame。旧记录缺少计数字段时可以统计同一 frame 的 `cardBacks`；两者均缺失就标注未记录，不能从终局倒推填入历史视角。

## 不同地点的三个 agent 如何加入同一局

可信协调者用管理凭据创建一局：

```http
POST /api/v1/episodes
Authorization: Bearer <operator-token>
Content-Type: application/json

{"gameId":"take-time","playerCount":3,"scenarioId":"official-clock-1-1"}
```

返回 `episodeId` 及三个不同的 `seats[].token`。协调者只把对应座位的 token 发给该 agent。三个 agent 可以在不同机器、不同网络，独立请求同一个 HTTPS 服务；不需要在服务器进程内部调用模型。agent 不应获得 operator 凭据或其他座位 token。

每个 agent 的协议：

1. 读取规则：`GET /api/v1/games/take-time`。
2. 拉取自身视角：`GET /api/v1/episodes/{episodeId}/observation?after={updateCursor}`，带自己的座位 Bearer token。首次 `after=0`。
3. 讨论时提交 `speak`；共识由玩家达成，服务器不会自动生成对话或强制逐个发言。
4. 决定开始后提交 `look_hand`。之后只能观察、等候和提交自己可用的出牌动作。
5. 继续按自己的 `updateCursor` 轮询，断线恢复后可以补拉中间发生的公开变化。`updates[].preparedAt` 是服务器保存的该视角准备时间；接受动作的精确审计时间另见 rollout 事件。

讨论示例：

```http
POST /api/v1/episodes/{episodeId}/actions
Authorization: Bearer <this-seat-token>
Content-Type: application/json
Idempotency-Key: <unique-request-id>

{
  "observationId": "<latest-own-observation-id>",
  "decisionToken": "<latest-own-decision-token>",
  "action": {
    "type": "speak",
    "text": "第一格需要一张太阳牌；我们先约定各格的目标和开局方式。"
  }
}
```

看牌和出牌使用同一接口，分别将 `action` 换成 `{"type":"look_hand"}` 或 `{"type":"place","cardId":"<own-card-id>","position":1,"faceUp":false}`。

服务保存发言及动作的身份、时间、请求和实际观察。`decisionSummary` 是可选的私有简短决策说明，**不是玩家广播消息**；只有 `action.type=speak` 的文本进入讨论。完整模型运行文件走单独的 artifact 上传接口，不能通过讨论接口上传来绕过禁言。

### 并发和重试

自由发言允许任意玩家先提交，但服务会按接受顺序记录。若两个玩家依据旧视角同时操作，后提交者可能收到 `409 STALE_OBSERVATION`。它应重新观察、阅读新消息，再决定是否重新提交新的请求。

若网络超时且不知道原请求是否成功，先用**同一个** `Idempotency-Key` 和完全相同的请求重试，取得原始结果；不要自动换一个 key 造成重复发言。现有 `PlayerClient` 已封装观察、准备命令及保留重试对象。

## 本次验证

新增 `test/take-time-communication.test.ts`：

- 2/3/4 人初始牌背计数公开，但数字、卡牌身份和种子均不提前泄露。
- 暗置出牌和双人预备牌加入时，公开计数正确，隐藏数值保持隐藏。
- 三个独立 HTTP 客户端可以任意次序发言；同一玩家可连续发言；重试不重复记消息；断线式补拉保留中间消息；过期观察被拒绝；个人看牌后禁言，其他未看者继续；终局前后可重放审计。

本次针对性测试连同旧官方引擎测试共 **17 项通过**。HTTP 测试使用本机临时服务和独立座位凭据，验证协议隔离与并发约束，不冒充三个外地真实网络节点的部署测试。
