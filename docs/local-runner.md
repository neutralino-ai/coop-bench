# 本地规则运行器与 smoke CLI

`src/local-runner.ts` 在内存中调用同一套 `GameAdapter`，不经过 HTTP、不调用任何模型 API，也不创建 API 玩家令牌。它用于规则联调、确定性回放，以及之后接入策略函数。`src/smoke.ts` 枚举注册表里实际实现的全部 `scenario × playerCount` 组合。

## 一键运行

```powershell
node src/smoke.ts
node src/smoke.ts --game the-gang --repeats 3 --max-actions 500
node src/smoke.ts --out-dir artifacts --examples 3 --clock-step-ms 1000
node --test test/local-runner.test.ts
```

默认写入 `artifacts/smoke-report.json` 和最多三款不同游戏的 `local-trajectory-*.json`。报告逐局列出正常终局、截断或执行错误；有执行错误时 CLI 返回非零退出码。预算耗尽属于 `truncated`，不会被改成输了游戏。

**结果含义：**默认策略只机械选择合法示例，优先推进游戏，避免聊天、重排、暂停等循环。The Gang 优先拿无人持有的筹码。它没有读取全量牌面，也不是智能策略；输赢不能用来断言 AI 能力、SFT 样本质量或官方交流规则全部合规。The Mind 的调用时机尤其不能当成人类实时默契策略的等价实验。

## 接入策略

```ts
import { runLocalEpisode } from './src/local-runner.ts';
import { getGame } from './src/registry.ts';

const result = await runLocalEpisode(getGame('the-gang'), {
  setup: { playerCount: 3, scenarioId: 'base', seed: 'trusted-coordinator-seed' },
  purpose: 'policy-evaluation',
  policyName: 'my-policy-v1',
  maxActions: 500,
  policies: {
    p1: async ({ observation, observationHistory, legalActions }) => chooseAction(observation, observationHistory, legalActions),
    p2: async ({ observation, observationHistory, legalActions }) => chooseAction(observation, observationHistory, legalActions),
    p3: async ({ observation, observationHistory, legalActions }) => chooseAction(observation, observationHistory, legalActions),
  },
});
```

`chooseAction` 由调用方提供。每次回调只收到游戏/场景/座位标识、**该玩家自己的 observation、observationHistory** 和 **该玩家的 legalActions**；没有 seed、完整 state、对手观察、特权 audit 或隐藏 RNG。输入先深拷贝并冻结，防止无意中修改局面。`purpose: 'policy-evaluation'` 要求 `policies` 覆盖每个席位，或显式传入公共 `policy` 作为未单独配置席位的策略；遗漏会在开局前报错。传入自定义 policy/policies 而省略 purpose 时，现在默认 policy-evaluation，避免研究者无意中使用机械调度或用机械动作补缺席玩家。只有显式 mechanical-smoke 或未传策略的默认机械检查允许未配置席位使用机械策略。

`observationHistory` 是模拟广播的合法可见快照，按时间顺序覆盖 setup（首次调用）或该玩家上次策略调用之后的变化。运行器在 setup、每次接受动作、每次系统时间推进后，对每位玩家调用自己的 `observe`；只有这个玩家的可见投影改变才缓存新快照。这样 Crew 的上一墩、Bomb Busters 的上一条公开结果即使后来被覆盖，也能在该玩家下一次决策时收到。它不包含其他玩家的原始 action、全局事件序号、状态摘要或不可见提交的空占位；可见投影完全相同的秘密提交不会增加历史条目。每次调用策略都会消费该玩家的队列，策略需要自行保留更早记忆；当前 `observation` 始终直接提供，即使本次历史为空。

这是一条工程数据边界，不是 JavaScript 安全沙箱。恶意同进程代码仍可能访问文件、网络或共享闭包；严肃对抗评测应把每个策略放入隔离进程/容器，通过服务端观察接口交流。不得把整份轨迹文件交给参赛 agent。

## 调度与计时

调度器属于可信运行器，与策略分开，只看 activePlayers、可行动作的类型名称和上次行动者，不把其他玩家的参数或观察交给当前策略。

- policy-evaluation 默认使用 `fairScheduler`：按座位轮换有合法操作的玩家，不按动作名称优先级压过或排除沟通。轮到此玩家得到执行机会后，具体是否发言、看牌或出牌由其策略决定。
- mechanical-smoke 保留 `mechanicalScheduler`：优先推进游戏，跳过自由聊天，专用于接口/回放检查，不能评估合作能力。
- 调用方显式提供的 scheduler 始终优先。公平轮询是串行评估基线，不等价于人类实时并发；正式时序研究仍需明确自己的调度和计时协议。

2026-09-17 修正前，policy-evaluation 也默认继承机械调度，可能使仅可聊天的非当前玩家一直得不到执行机会；这是本地批量运行器的缺陷。HTTP 服务不调用此调度器，各地 Agent 自行通过 API 提交合法操作，不受该过滤影响。修正不增加虚构的强制聊天轮次，也不更改游戏规则。

`advanceTime` 只能由系统注入。含这个方法的游戏必须显式指定正整数 `clockStepMs`；每次推进都会写成独立的时间事件。CLI 默认 `1000ms`，表示模拟时间，并不测量模型思考耗时。运行器同时限制 `maxActions` 与 `maxTimeAdvances`；限制到达时截断。如果官方计时状态先到终局，那才是游戏自身的胜负。

## 回放证据与训练行

输出分两类：

- `audit`：特权数据，包含 seed、设置、全部行动/时间事件、前后状态摘要、对应玩家观察及历史摘要和最后结果。`replayLocalAudit(game, audit)` 从 setup 重放，重新生成每位玩家可见广播并验证决策历史、每一步与最终结果。没有保存 API token，也不返回重建的全量 state。
- `trainingRows`：包含本座位决策时的 observation、observationHistory、legalActions、action，以及该座位下一次决策时的 nextObservation、nextObservationHistory、nextLegalActions。历史只包含规则允许该座位看到的中间变化，未拼接其他座位的私有输入。

加入历史后的本地审计与训练行 schema 为 `local-audit/v2` 和 `local-transition/v2`。旧 v1 轨迹不具备这些证据，应重新运行以生成 v2 文件。

每个玩家最后一行接到该玩家终局/截断观察，并通过 nextObservationHistory 保留其最后决策之后出现的公开信息；策略返回 null 造成截断时也保留已经送达该次调用的历史。普通胜负的团队终局奖励是胜利 `1`、失败 `0`，之前步骤为 `0`；尚未完成的截断行奖励为 `null`。Hanabi `score-only` 终局保留原始分数，奖励也为 `null`，由训练任务明确决定是否采用得分奖励，运行器不私自定义胜负阈值。

SFT 可以取合规轨迹的 `observationHistory + observation + legalActions → action`，但应先做交流合规与样本质量筛选，并按需拼接同一玩家更早的历史或维护策略记忆。RL 可以使用按玩家连接的 transition；若需要每次环境动作的事件流，读取特权 audit 后由可信采样器处理，不能将对手私有数据加入策略输入。训练/验证拆分必须按完整 episode 和种子谱系分组，不能随机拆同一局中的行。

`partitionFamily = SHA256(canonical({sourceSeed: seed}))` 只依赖根种子，不包含游戏、场景、人数或配置；同一 seed 派生的这些变体保守地放在同一个数据划分。它属于数据集元信息，不传给策略，也不应拼进 SFT 输入。若上游已经从一个祖先种子产生了不同字符串种子，上游还必须保留祖先谱系并合并分组；运行器无法从无关联字符串自动恢复这个关系。

## 当前限制

- 运行器不训练权重、不调用模型，不宣称 smoke 样本是专家示范。
- 规则合法性由 adapter.step 最终裁决；无效策略动作作为执行错误暴露，不默默修成合法动作。
- schema 的完整性由游戏模块维护；示例列表不是所有游戏理论动作空间的统一枚举器。
- `audit` 的摘要用于回放一致性检查，不是对恶意文件作者的数字签名证明。
- 没有执行正式 HTTP 并发压测；本地串行规则跑通与生产部署能力是不同验证。
