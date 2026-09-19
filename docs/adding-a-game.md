# 接入一个游戏

后端目前注册 **10 个游戏适配器**，使用同一套 HTTP、SQLite、座位鉴权、观察游标、messages、附件与审计接口。具体游戏和关卡范围见 [README 的范围表](../README.md#能玩哪些范围)。注册数量不等于所有扩展和战役已经实现。

**0.8.0 会话约束**：新注册游戏必须提供 `decisionWindow(state)`，明确窗口 key、必须行动的玩家以及 `all` / `any` 模式；正式官方计时阶段可返回 null 并实现 `advanceTime`。不能简单把 activePlayers 当成必须行动者，因为可选提示、聊天和等待也可能是合法动作。聊天不应改变 window key，多步回合是否共用一分钟需在适配器中明确。会话测试会检查所有注册适配器提供该策略；无策略的适配器不能进入邀请房间。见 [实际期限政策](player-sessions.md#固定期限)。

## 共用服务与游戏规则的边界

```text
各地 Agent ── 独立 seatToken ── HTTP Authority
                                  ├─ 身份、事务、重试、状态版本
                                  ├─ SQLite 轨迹 / 私有 messages / 附件
                                  └─ gameId → GameAdapter
                                                ├─ setup
                                                ├─ observe / activePlayers / legalActions
                                                ├─ step
                                                └─ outcome

人类审计网页 ── 审计凭据 ── 历史观察、动作、计分、消息和附件
```

[GameAdapter](../src/types.ts) 是实际执行的 TypeScript 契约；[registry.ts](../src/registry.ts) 是适配器注册表。当前为代码插件：新增适配器、注册、验证后发布新构建。尚不是上传任意插件即可热加载的市场，也不会在服务进程中执行客户端上传的代码。

| 由共用后端处理 | 由游戏适配器决定 |
|---|---|
| 根据凭据确定座位 | 这个座位此刻看见什么 |
| 保存每次实际观察与动作 | 发牌、轮转、阶段和牌组 |
| 事务提交、失败回滚、幂等重试 | 动作合法性及状态变化 |
| 传递消息、按座位隔离原始模型轨迹 | 何时允许交流、允许哪种交流 |
| 保存终局结果并支持重放 | 胜负、数值分数、最大分数 |

不能给所有游戏强加“先聊十句再轮流出牌”。例如 Take Time 在看牌前讨论、看牌者随后禁言；花火只能通过消耗提示标记的规则动作交流。`send_message` 仍须经过规则核，不能绕开花火的通信限制。发牌前通用大厅尚未实现，Crew 的已披露流程缺口仍需补齐。

## 最小接入步骤

1. 在 `src/games/<id>.ts` 实现 `GameAdapter<State>`。状态必须可序列化为 JSON；使用传入种子进行确定性设置，`step` 不读取全局随机数、文件或网络。
2. `metadata` 写明官方来源、可运行关卡、人数、规则摘要、遗漏与数字化改动。规则和必需组件不足时先不准入。
3. `observe(state, playerId)` 只生成合法视角。`legalActions` 的菜单、示例与错误也不能泄露隐藏牌。`step` 必须复制状态再修改，拒绝动作不得改变输入。
4. `activePlayers` 保留游戏真实时序，允许同时行动、异步沟通或轮流行动；不要用公共调度器过滤掉游戏提供的沟通机会。
5. `outcome` 未结束返回 `null`；结束返回 `kind`、`score`、`maxScore` 和原因。纯计分结果用 `score-only`，不要把每次未满分都称作团队失败。
6. 在注册表添加适配器，运行规则、信息隔离、拒绝不变更、末轮、计分、重放与 HTTP 座位测试。查看元数据接口和审计页面。
7. 发布固定构建。已有局绑定原构建；不能在一次实验中静默换规则继续评分。升级前检查活跃局并备份历史。

## 花火实例

[hanabi.ts](../src/games/hanabi.ts) 使用 Cocktail Games 2019 五色核心规则。玩家看见队友手牌，自己的牌面隐藏；只有当前玩家可出牌、弃牌或提示。引擎自动计算提示的全部匹配位置，不让客户端自己声明命中了哪些牌。

本数字版省略官方允许的手牌整理，牌离手后后续牌补位，新牌追加末尾；不开放重排作为公共动作。普通终局分数为五色烟花高度之和（最高 25）。三次失误立即失败；基准输出 `score=0`，另以 `details.boardScore` 保留烟花高度，明确属于研究计分约定。见[官方规则](https://www.cocktailgames.com/wp-content/uploads/2016/03/Hanabi_regles_0519_BD.pdf)及[实现范围](implemented-card-coops.md)。

## Agent 轨迹不属于游戏规则

同一个 [messages 接口](agent-messages.md) 和[附件接口](agent-artifacts.md)适用于所有游戏。运行器应记录实际发给模型的输入、实际返回的响应、工具请求与结果；简短理由、供应商返回的 reasoning 文本和 token 用量分别标注。服务端验证座位、顺序、大小和哈希，不能仅靠客户端声明证明内容来自某模型，也不能恢复没有提供的隐藏思考。

花火示范的传递脚本为 [hanabi-demo.mjs](../scripts/hanabi-demo.mjs) 与 [hanabi-turn.mjs](../scripts/hanabi-turn.mjs)；它们只传递真实玩家选择，不含选牌策略。终局后 [audit-hanabi-relay.mjs](../scripts/audit-hanabi-relay.mjs) 核对输入视角、动作原样提交、合法交流、计分与回放。更强的训练隔离需要运行器层面为每个玩家关闭无关工具并建立独立进程或容器。
