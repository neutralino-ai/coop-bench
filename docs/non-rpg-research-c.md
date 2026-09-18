# 非 RPG 合作桌游补充核查：协作谜题、词语与调度

核查日期：2026-09-16。排名为 BGG 官方页面的近期搜索索引快照，非实时承诺。本文是候选研究，不代表已实现环境。

## 筛选口径

本轮排除以角色成长、装备、剧情战役或地城战斗为主要内容的游戏。游戏里出现职业、精灵、棋子或者“任务”字样，本身不足以判成 RPG。进一步区分：

- **主要候选**：共享目标，信息或行动分散，合作沟通本身形成谜题。
- **战略对照**：纯合作、非 RPG，但核心更接近共同规划，未必像 Take Time。
- **自然语言对照**：胜负或得分可计算，但提示词合法性可能需语言裁判，不能把完整官方规则宣称为完全精确的 RLVR。

## 核查摘要

| 游戏 | 官方人数 | BGG Overall 快照 | 是否符合此次方向 | 任务/公开资料 | RLVR 判断 |
|---|---:|---:|---|---|---|
| Just One | 3–7 | 159；抓取 3 天前 | 纯合作词语；共享得分 | 官方规则；随机抽 13 张；不是固定关卡集 | 得分可算；词族、拼写变体、谐音等合法性不可仅用字符串相等 |
| So Clover! | 3–6 | 264；抓取上周 | 纯合作词语重建；共享得分 | 官方规则；随机布局，可增加干扰卡 | 卡牌位置/方向与得分可算；提示词合法性单独处理 |
| Codenames: Duet | 2 或更多，通常双人 | 277；抓取 2 天前 | 双方共同赢输，信息不对称 | 官方规则、任务地图；注意 2017 版与刷新版差别 | 身份/回合/结果可算；语义提示合法性需裁判或明确研究约束 |
| Magic Maze | 1–8 | 806；当日抓取 | 很贴近合作协调；公开局面、分散行动权限 | 官方规则含场景 1–17；地图组件另需核对 | 移动/结果可算；实时计时与非语言信号需要忠实建模 |
| Switch & Signal | 2–4 | 2144；抓取 4 天前 | 纯合作列车调度，战略补充 | 官方规则、欧洲/北美双面地图与难度变化 | 规则与结果可精确；地图、列车/牌/骰面需完整转录 |

排名来源：[Just One](https://boardgamegeek.com/boardgame/254640/just-one)、[So Clover!](https://boardgamegeek.com/boardgame/329839/so-clover/forums/288)、[Codenames: Duet](https://boardgamegeek.com/boardgame/224037/codenames-duet)、[Magic Maze](https://boardgamegeek.com/boardgame/209778/magic-maze)、[Switch & Signal](https://boardgamegeek.com/boardgame/317311/switch-and-signal)。Switch & Signal 排名较后，应作为机制补充，不能包装为高排名优先候选。

## Magic Maze：动作权限分散的无声合作

每人拥有部分移动或探索权限，能操作任一棋子；大家共同完成取物和撤离。主要局面公开，难点是谁能做什么、何时协作，属于实时合作谜题。奇幻职业仅是题材与少量棋子能力，不是角色成长型 RPG。[官方产品页](https://sitdown-games.com/produit/magic-maze/)

官方基础规则支持 1–8 人，场景 1–7 逐步教规则，8–17 添加挑战。准备阶段可讨论，正式行动多数时间禁言，存在限定的讨论窗口和“Do Something!”提示棋子。**原版没有轮流行动**；把它改成三名 agent 顺次回合，会改变问题。可做服务器权威时钟与并发动作队列；如果改用离散步数预算，应标为研究变体。[官方规则 PDF](https://sitdown-games.com/wp-content/uploads/2018/09/MM_Rules_EN_HR_Sept2018_LD.pdf)

规则中公开了场景配置，但不应据此断言 24 块地图的数据已完整取得。数字实现还要核每块地图的墙、入口、特殊格与朝向。不要自动纳入 Hidden Roles 扩展；本轮只讨论基础纯合作模式。

## So Clover!：先独立编码，再共同解码

玩家各自依据秘密词语布局写提示，再由其余玩家讨论并复原；出题者在该阶段保持沉默。官方人数 3–6，目标是全队得分，不是个人竞争。[官方产品及下载页](https://www.rprod.com/index.php/en/games/so-clover)

公开规则含随机布局、干扰卡和增加干扰卡的难度选项，未核到编号式任务册。牌位置、方向、尝试次数和分数可以精确验证；同词族、翻译和自造词限制涉及语言判断。训练时需拆开 `outcome_verifier` 与 `clue_legality_verifier`，不得把后者悄悄省略后仍称完整官方模式。[官方英文规则 PDF](https://cdn.svc.asmodee.net/production-rprod/storage/downloads/games/so-clover/sc-en01-rules-16197761427wP8d.pdf)

很适合研究私有意图如何通过短提示传给团队，但应放在“自然语言协作”分组，与纯数值动作环境分别报告。

## Just One：避免提示撞车的团队协作

一人猜词，其余人独立写提示；重复或不合法的提示取消后再展示。官方为 3–7 人，随机抽取 13 张卡，追求团队得分。它不是固定关卡推进游戏。[官方产品页](https://www.rprod.com/it/games/just-one)

2025 英文规则明确把词族、单复数、拼写错误等也纳入重复提示；提示词还受翻译、词族、谐音等限制。若只做小写字符串去重，会实现错规则。当前规则还给出 3 与 4 人两提示变体，不能直接套用旧版“三人才两提示”的实现。[当前官方英文规则 PDF](https://cdn.svc.asmodee.net/production-rprod/storage/games/justone/NEW/jo-en02-rules-mkt-1749635213L3H57.pdf)

适合研究独立决策下的协调失败、提示多样性。若采用词典或人工审核来裁定合法性，需将规则、版本和裁定记录写入轨迹；LLM 裁判的结果不应称为无歧义硬验证。

## Codenames: Duet：要选合作双人版

Duet 是单一队伍；普通 Codenames 的默认模式是两队对抗，不能替换。Duet 双方分别看到不同秘密身份，通过词语提示共同找出目标，失败也共同承担。官方允许双人或更多人分成两边协作。[当前官方规则 PDF](https://filemanager.czechgames.com/storage/files/codenames-duet/rules/codenames-duet-rules-en.pdf)

2017 版含逐步增加难度的任务地图；新版将任务地图放在免费的 Codenames Companion。旧官方 `czechgames.com/files/rules/codenames-duet-rules-en.pdf` 仍被搜索引擎索引为原规则，但本次直接打开已重定向到普通 Codenames 页面。实现需固定版本，不能把两套入口当相同内容。[2017 官方销售资料](https://filemanager.czechgames.com/storage/files/codenames-duet-2017/sales-sheets/codenames-duet-eu.pdf)、[新版官方产品页](https://www.codenamesgame.com/boardgames/codenames-duet)

身份揭示、回合耗用、胜负可以精确验证；自然语言提示的语义约束另需审查。官方词卡、身份卡与任务的完整可用数据需要单独清点。研究生成的词库或身份图须有独立来源标记。

## Switch & Signal：运输调度对照

共同调配不同速度的列车，切换道岔与信号，把货物送达终点。官方 2–4 人；基础盒有中欧和北美两张地图。规则书公开，规则中的部署/移动随机性可用种子重放。[官方产品页](https://www.thamesandkosmos.co.uk/product/switch-and-signal/)、[官方规则入口](https://www.thamesandkosmos.com/manuals/full/694265_switchsignal_manual.pdf)

本次规则 PDF 直接打开因重定向/大小限制未能完整读取，已通过官方索引核实人数、机制与组件。未核到官方编号任务册；不能把社区地图当官方关卡。它的主要价值是时间与运输资源的协同规划，排名与信息隐藏强度均不支持将其置于 Take Time 类首选。

## 两款战略对照：不应因为有“角色”就误删

### Spirit Island／精灵岛

是非对称能力的纯合作战略游戏，基础版 1–4 人；没有以剧情角色扮演为核心。官方商店提供规则下载，基础盒含场景与对手面板。BGG 近期总榜 11。[官方页](https://shop.greaterthangames.com/products/spirit-island)、[BGG](https://boardgamegeek.com/boardgame/162886/spirit-island)

可以保留作复杂规划对照，但用户此轮所指的 Take Time 式协作谜题，应排在它前面。其实现负担主要是大量独特能力、结算时序及地图关系，不是自然语言沟通谜题。

### Pandemic／普通瘟疫危机

普通基础版是 2–4 人、全员共同赢输的合作规划游戏。职业提供特殊能力，不等于 RPG；本项不包含 Legacy 战役。BGG 近期总榜 174。[官方页](https://www.zmangames.com/game/pandemic/)、[BGG](https://boardgamegeek.com/boardgame/30549/pandemic)

官网公开基础规则、两个 Scenario 链接及 **10 份 Pandemic Puzzles**。但不能把这些都视作基础盒任务：例如官方 Puzzle 1 使用 Archivist 角色，需另核扩展能力。谜题还可能附带解答，应把解答与 agent 输入隔离。[Puzzle 1 官方 PDF](https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/Pandemic-Puzzle-1_Archival-Expert.pdf)

这些局部谜题适合规划验证；完整对局适合资源协调。若研究重点是信息受限协作，应以适配的隐藏信息游戏为主，用它作不同能力维度的对照。

## 环境选择结论

这批里 Magic Maze 最能补充 Take Time 的“默契与动作协作”，但真实时间机制需要单独设计。Codenames: Duet、So Clover!、Just One 适合语言协作研究；应明确“结果精确”与“所有线索合法性精确”是两回事。Pandemic 和 Spirit Island 可以保留为非 RPG 的纯合作规划对照，Switch & Signal 是较低排名的机制补充。

规则公开、组件完整、数字化复用许可和训练数据使用范围是不同字段；本次只确认公开来源与适配性，未把公开规则误标为开放许可。
