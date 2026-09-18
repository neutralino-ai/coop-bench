# 已实现：四款数字牌合作游戏

实现日期：2026-09-16。代码使用 `src/types.ts` 的 `GameAdapter`，均导出 JSON 可序列化状态、纯状态转移、玩家观察、动作 schema 和可执行示例。每款目前唯一 scenario 为 `base`。完整来源与 SHA-256 见 `sources/card-coops/manifest.json`。

## 范围与接口

| gameId / 导出 | 人数 | 实际实现范围 | 主要动作 |
|---|---|---|---|
| `hanabi` / `hanabi` | 2–5 | Cocktail Games 2019 基础五色 50 张牌；允许空提示 | `hint`, `play`, `discard`, `reorder` |
| `the-gang` / `theGang` | 3–6 | Kosmos 2024 基础版，完整 3–5 次抢劫，每次四轮 | `claim`, `release`, `chat` |
| `the-game` / `theGame` | 1–5 | NSV 原版基础，完整 98 张数字牌 | `choose_start`, `play`, `end_turn`, `chat` |
| `the-mind` / `theMind` | 2–4 | NSV 原版明置完整 12/10/8 级；生命、飞镖、暂停及奖励 | `ready`, `stop`, `play`, `star_vote` |

单人 The Game 有官方规则；训练多智能体时选择 2–5 人。没有实现 The Gang 专家/挑战牌、The Game 专家难度、Hanabi 扩展或专家终局、The Mind 通关后的盲打续挑战。以上明确选择独立的官方基础模式。

### Hanabi

固定 [Cocktail Games 2019 基础版](https://www.cocktailgames.com/wp-content/uploads/2016/03/Hanabi_regles_0519_BD.pdf)，其法文示例允许“没有某颜色/某数字”的提示。自己的 observation 中只有牌位、无含义的牌 ID 与已获得的排除信息；别人手牌可见。给提示会同时更新命中与未命中的知识。`play` 的合法动作列表不会筛掉实际上打错的牌，避免通过动作列表泄漏自手牌。

规则是合作计分：满分 25 才设置 `success=true`；未爆炸且末轮结束、未达满分时返回 `kind='score-only'`，`score` 为五色烟花高度之和。第三次错误立即以 `kind='loss'`、`reason='explosion'` 结束；此时 `score=0` 是 benchmark 的研究计分约定，官方规则只规定立即失败，并未指定爆炸的数值分数。已搭烟花高度保存在特权记录的 `details.boardScore` 中。`p1` 替代规则中“穿着最鲜艳者开始”的无策略起始约定。

数字手牌采用固定槽位，不支持 `reorder`；牌离手后余牌依次补位，新摸牌追加到末尾。官方允许接收提示者重排手牌辅助记忆，这项实体操作在本实现中明确省略。

### The Gang

读取了 [官方规则全文](https://www.thamesandkosmos.com/manuals/full/683887_TheGang_Manual-Web_051624.pdf)。第 6 页明确：全员各有一枚本轮筹码就立即进入下一轮。因此没有人为添加 `confirm`；也不强制轮流行动。

`claim {rank}` 可以从中央或另一名玩家处拿筹码；后者失去该筹码。有筹码时先 `release` 再拿新筹码。规则禁止把筹码放到另一玩家面前，因此没有直接把自己的旧筹码塞给对方的双向 `swap`。已结束轮次的筹码仍可见。红筹码顺序最终按七选五最大牌型检查；平局允许，A 可作为 A2345 的低端，但不能跨越 K-A-2 构成顺子。

### The Game

从 [NSV 官方英文 PDF](https://www.nsv.de/wp-content/uploads/2024/04/TheGame_GB.pdf) 核实：1/2/3–5 人手牌上限为 8/7/6；看牌后协商起始玩家；牌库存在时每回合至少两张，耗尽后至少一张；每张逐一出牌，结束回合才补牌。无牌玩家跳过；未达到最低出牌量而无法继续时终局。四堆只投影顶牌。

正常递增/递减之外，恰好反向十允许。完成全部 98 张是胜利；官方失败评量是剩余牌数，接口给出 `score=已出牌数` 和 `details.unplayed`，两者可精确转换。

### The Mind

读取 [NSV 官方英文 PDF](https://www.nsv.de/wp-content/uploads/2024/04/TheMind_GB.pdf) 并渲染其图示。所有玩家在 `play` 阶段都可随时打自己的最小牌，不接受轮流表。错误一次仅损失一条命，即便跨过多张牌；所有被跨过的低牌移走，仍继续本级，先重新专注。飞镖需所有人同意，可在级内专注或出牌阶段提议；使用后各自移除最小牌并重新专注。

新的手牌变化或 `stop` 会撤销尚未完成的飞镖同意，避免将旧手牌下的同意应用于新局面。这是显式的数字同步约定。等级完成后重洗全部 100 张；2/5/8 级奖励飞镖，3/6/9 级奖励生命，最多三枚飞镖和五条命。

**时机局限：**API 保存实际请求到达的顺序；适配器本身不创造等待秒数、不设置按牌号等待的协议。使用固定座位轮流调用的 agent runner 会改变游戏，不能用于声称等价的人类比较。网络延迟、轮询频率与模型响应时间需在实验中另行控制。完成胜负可以验证，但此实现没有证明 agent 未数秒或未用外部暗号。

## 沟通审计边界

The Gang 官方允许基于公开信息讨论，The Game 允许不透露具体数字的广泛讨论，两者均保留 `chat`。消息是否间接泄漏手牌无法仅靠字符串格式可靠判断，因此标为 `verifier='objective-only'`：出牌、状态和终局由程序精确验证，语言合规需单列审计。不能因为一次游戏赢了就自动把其聊天轨迹当成合规 SFT 样本。

Hanabi 采用严格提示动作模式，不提供自由聊天。The Mind 只有专注、停止与飞镖表态等规则控制信号。合法动作列表与观察均禁止暴露隐藏牌序或 RNG。

## 验证

```powershell
node --test test/hanabi.test.ts test/the-gang.test.ts test/the-game.test.ts test/the-mind.test.ts
```

20 项定向测试覆盖：

- 正确牌组、人数手牌和隐藏信息；Hanabi 动作 mask 不依赖自己的真实牌值。
- Hanabi 空提示、负信息、禁止满提示弃牌、最后一轮、爆炸与满分。
- The Gang 自由筹码操作、自动推进、最佳五张/踢脚牌/A2345/平局及完整胜局。
- The Game 反向十、补牌时点、最低张数变化、无法完成最低量、跳过空手与终局。
- The Mind 无轮序、一次错误多张跳过只扣一命、专注、飞镖同意、完整等级与奖励上限。

测试里的全知选牌只用于校验规则终局，**不是 agent 胜率或隐藏信息策略能力的证据**。这些游戏模块可以接入统一服务；本文件不将 HTTP、数据库、训练任务或正式用户 UI 的完成情况算入模块测试结果。
