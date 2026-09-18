# 通用服务、沟通与失败原因复核

核对日期：2026-09-17。用户质疑：是否服务端忽略沟通，导致 Take Time 失败，并可能影响所有合作游戏。

## 逐局证据

| 对局 | 实际控制器 | 沟通 | 结果与可得结论 |
| --- | --- | --- | --- |
| c30c442e，9/15 | 三个真实子智能体，经早期 take-time HTTP 接口 | 6 条，随后各自看牌 | 失败，总和 6、6、9、15、19、15，唯一失败条件为第五格大于第六格。讨论提到末轮预留较大牌，实际末格为 8、2、5。可定位末两格分配及协作执行问题，不能从结果重建未记录的内部判断。 |
| 636c8948，9/17 本地 | 三个真实子智能体，经 coop-bench HTTP 接口 | 6 条 | 胜利，总和 1、10、11、14、22、25。 |
| 71a3d7ec，9/17 云端 | 机械部署验收脚本 | 0 条；脚本过滤 speak，直接 look_hand | 失败，12 张都放第一格，其余格空。这是“选第一个推进动作示例”的结果，不能用来评价模型理解或合作能力。 |
| 9a40164c，9/17 云端 | 三个真实子智能体，经 coop-bench HTTPS | 4 条 | 胜利，总和 3、3、5、10、20、29。 |

真实 Agent 三局均用了 3 次可选明置，不是全暗置实验。它们不是同一发牌、同一实验条件下的对照试验，也不构成正式胜率估计；成功局不证明其他游戏正确，失败局也不证明所有游戏都会失败。

证据：[早期失败局原始记录](../../take-time/artifacts/official-llm-game.json)、[早期会话说明](../../take-time/artifacts/official-llm-session.md)、[本地成功局核对](../artifacts/http-agent-demo-2026-09-17/evidence-checks.json)、[云端机械报告](../artifacts/security-2026-09-17/cloud-api-validation.json)、[云端真实 Agent 审计](cloud-agent-demo-audit.md)。本次重新执行早期失败局 replay，verified=true，原样得到 6、6、9、15、19、15。

## 共用层和游戏规则层

| 层 | 职责 | 目前实现 |
| --- | --- | --- |
| 服务层 | 座位身份、观察隔离、幂等请求、持久化、轨迹、消息/附件、审计权限 | Authority、HTTP routes、PlayerClient 通过 registry 调用 adapter，没有 Take Time 的看牌或发言跳过逻辑。消息采集与附件对各游戏共用。 |
| 游戏规则 | 发牌、允许观察的信息、何时谁能说什么、合法动作和结算 | 每款 GameAdapter 实现 setup/observe/activePlayers/legalActions/step/outcome；当前注册 10 款，官方关卡覆盖各有范围。 |
| 运行器/策略 | 给玩家执行机会；玩家在合法动作中选择沟通或行动 | 各地 HTTP Agent 自行行动；本地批量 runner 的调度和策略独立配置。机械检查策略不适合合作评估。 |

通用意味着新增游戏复用同一套身份、状态和研究接口，并接入其规则适配器。不是只传任意游戏名字就能自动掌握规则。也不能给所有游戏强行添加同一个自由讨论阶段：沟通窗口和禁言限制应由实际规则决定，适配器必须完整暴露。

## 实际发现并修正的共用问题

`local-runner.ts` 旧版 policy-evaluation 默认也使用 mechanicalScheduler。该调度优先推进动作并跳过 chat/message/speak，即使自定义策略愿意交流，只有沟通可做的玩家也可能一直不被调度。这是会影响其他合作游戏的真实缺陷，不能用“是烟测”掩盖评估模式也用了这个默认值。

修正：policy-evaluation 默认公平轮换所有有合法操作的活跃玩家；自定义 policy/policies 默认进入评估模式，并要求所有席位有明确策略。机械模式保留用于显式接口检查；显式 scheduler 仍可覆盖。新调度给沟通执行机会，不替 Agent 发言或虚构讨论轮次。详见[运行器说明](local-runner.md)。

该缺陷位于进程内批量 runner；HTTP 服务没有引入它，之前三个真实子智能体 HTTP 试玩也没有通过它调度，因此它不是早期真实失败的原因。本轮只修改本地运行器及其测试，云端 HTTP 服务仍是此前的 b8706e22277d 消息版本。

验证：定向运行器测试 16/16、全套 206/206 通过。新增回归确认只有 speak 可用的玩家得到执行机会，消息进入队友观察历史；真实 The Game 的非当前玩家能在下一次出牌前聊天；显式自定义调度器优先，缺策略不再静默回退。[测试输出](../artifacts/artifact-release/communication-scheduler-tests.txt)

## 沟通覆盖的具体边界

代码审查确认各游戏存在相应沟通动作：Sky Team 的 message/ready；Take Time 的 speak/look_hand；两个 Crew 的 communicate；Bomb Busters 与 The Gang/The Game 的受限 chat；Hanabi 的结构化 hint；Magic Maze 的 message/signal；The Mind 的 ready/stop/star_vote。它们的沟通形式不同，不能用“都有任意聊天”作为正确性要求。这是实现检查，未在本轮重验十本官方规则书。

**确实尚缺通用的发牌前大厅。** Crew 的规则元数据明确把发牌前一般讨论留给 external lobby，但项目没有实现对应的持久化大厅接口。目前不能声称这一研究流程也已经统一支持。已有 `/episodes/:id/messages` 是私有模型轨迹，不是可让队友读取的大厅，不能拿它替代该缺口。

自由文本的内容限制也不是仅靠时机校验就能证明：暗示手牌数字、约定编码等需要单独审计。公平轮询仍是串行评估基线，null 当前含义是截断而非等待；实时游戏需要明确自己的独立客户端/时钟调度。

## 后续评价标准

每款游戏分别检查：规则/组件覆盖、沟通动作和可见性、独立玩家接口、完整比赛 messages、稳定种子集上的策略表现。接口正确、规则正确、策略有效是不同结论，需要分别给出证据。机械 smoke 的输赢不应混入 Agent 胜率或专家 SFT 数据；当前没有证据声称十款游戏都已通过真实 Agent 合作能力评估。
