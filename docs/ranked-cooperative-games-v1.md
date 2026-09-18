# 先按排行榜筛选合作桌游

> 历史筛选稿，已被 [非 RPG 合作游戏清单](ranked-cooperative-games.md)替代。保留以便追溯资料来源，不再代表当前选题。

查询日：**2026-09-16**。本轮交付的是排名筛选、官方资料调查和环境接口设计；没有把下列游戏标成已经实现。

## 1. 排名口径

采用 **BoardGameGeek（BGG）所有桌游的 Overall 总榜名次**，然后筛选合作游戏。不是销量榜、原始平均分排序，也不是从 1 开始重新编号的“合作游戏榜”。

主要依据：[BGG 合作机制关联游戏，按总榜排名排序](https://boardgamegeek.com/boardgamemechanic/2023/cooperative-game/linkeditems/boardgamemechanic?mechanicfilter=2023&pageid=1&sort=rank)。BGG 直接页面在本轮多次返回 403，因此使用搜索引擎最近抓取的 BGG 原站内容；这是一份**近期快照，不保证查询瞬间的实时排名**。主清单采用该页面同一快照；补充项的单游戏来源和抓取差异见分组报告。

筛选还检查合作方式：BGG 的合作机制标签可能包括兼有其他模式的游戏。默认半合作的 Nemesis（约第 25）以及拥有多种玩法的 Mage Knight（约第 39）另列备选，不直接与默认共同胜负游戏混合训练。

## 2. 首批十款高排名合作游戏

“环境研究价值”是本项目的分析，不是 BGG 对模型训练的评价。

| BGG 总榜 | 游戏 | 环境研究价值 | 规则与任务资料现状 |
|---:|---|---|---|
| **3** | **Pandemic Legacy: Season 1**／瘟疫危机：传承 第一季 | 团队资源分配、路线规划、跨局状态 | 官方规则 PDF 已找到；热身模式明确；完整 Legacy 解锁数据未核实 |
| **4** | **Gloomhaven（2017）**／幽港迷城 | 合作战术、行动牌管理、受限交流 | 当前官网为 2025 第二版；原版规则与完整场景输入需固定来源 |
| **11** | **Spirit Island**／精灵岛 | 非对称角色、空间规划、快慢行动配合 | 官方基础规则入口已找到；完整能力牌、地图、精灵数据待核 |
| **12** | **Gloomhaven: Jaws of the Lion**／幽港迷城：雄狮之颚 | 教学关逐渐增加规则，适合课程训练 | 官方确认渐进教学；完整教学关地图与牌面输入待核 |
| **15** | **Slay the Spire: The Board Game**／杀戮尖塔桌游版 | 合作牌组构筑、战斗与长期规划 | 官方规则和资料入口已找到；需要完整卡牌与遭遇数据 |
| **20** | **Frosthaven**／霜港迷城 | 高复杂度战术、据点与跨局发展 | 官方规则核对来源存在；完整内容与使用范围需分别核验 |
| **32** | **Sky Team** | 双人隐藏骰子、阶段性沟通、协同操作 | 官方基础规则及 Flight Log 公开，首个机场需准确转录棋盘数据 |
| **33** | **Arkham Horror: The Card Game**／诡镇奇谈：卡牌版 | 非对称调查员、场景目标、牌组规划 | 官方规则与战役指南公开；卡牌数据库、规则版本与代码许可另核 |
| **37** | **Too Many Bones** | 非对称角色、骰子技能、合作战术 | 官方规则资料入口已找到；完整角色、敌人、遭遇输入需核 |
| **45** | **The Crew: Mission Deep Sea** | 隐藏手牌、受限信号、吃墩任务分工 | 官方规则及任务资料可调查；完整任务卡覆盖不能仅由规则书推出 |

排名证据同上；The Crew: Mission Deep Sea 的第 45 名也用[当日抓取的 BGG 统计页](https://boardgamegeek.com/boardgame/324856/the-crew-mission-deep-sea/stats)复核。旧缓存可能显示第 44 名。

第一组官方资料与缺口详见 [research-top-a.md](research-top-a.md)，第二组详见 [research-top-b.md](research-top-b.md)，Sky Team 详见 [research-top-c.md](research-top-c.md)。

### 已核对的直接官方入口

- [Pandemic Legacy S1 官方规则 PDF](https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/zm7170_zm7171_rules_web.pdf)
- [Gloomhaven 出版商页面——注意现为新版](https://cephalofair.com/pages/gloomhaven)
- [Spirit Island 出版商页面及规则下载](https://shop.greaterthangames.com/products/spirit-island)
- [Jaws of the Lion 出版商页面](https://cephalofair.com/products/gloomhaven-jaws-of-the-lion)
- [Frosthaven 出版商页面及勘误](https://cephalofair.com/pages/frosthaven)
- [Sky Team 出版商规则、Flight Log 与额外场景](https://www.scorpionmasque.com/en/sky-team)

其他规则 PDF、任务来源及可复用代码的逐项链接保存在分组报告，避免将第三方镜像误标为官方下载。

## 3. 增加机制覆盖面的候选

首批十款中有三款属于 Haven 家族。若最终目标是“十种尽量不同的合作能力测试”，可从以下高排名游戏替换部分同系列条目。这是研究候选集，不声称穷尽所有更靠前的合作游戏。

| BGG 总榜快照 | 游戏 | 补充价值 |
|---:|---|---|
| **50** | Marvel Champions: The Card Game | 英雄非对称、牌组配合、敌人阶段 |
| **54** | Cthulhu: Death May Die | 剧集目标、冒险风险、战术协同 |
| **58** | The Lord of the Rings: Fate of the Fellowship | 合作路线与资源规划 |
| **86–87** | Bomb Busters | 隐藏信息推理、受限提示；不同 BGG 近期缓存相差一名 |
| **96** | The Crew: The Quest for Planet Nine | 经典合作吃墩、渐进任务；与 Deep Sea 可复用部分引擎 |
| **109** | Aeon's End | 合作牌组构筑与角色配合 |

另调查 **Codenames: Duet（约第 277）** 作为自然语言沟通的机制对照；它不计入本轮高排名主清单。补充项来源见 [第二组](research-top-b.md)和[补充组报告](research-top-c.md)。

## 4. “公开关卡”要核查到什么程度

| 已找到的资料 | 能确认的事情 | 仍不能推出的事情 |
|---|---|---|
| 官方规则书 | 核心流程、动作、部分胜负规则 | 全部牌面、地图、敌人和任务数据已公开 |
| 官方战役／任务书 | 有哪些任务及场景规则 | 基础组件齐全，可独立运行所有任务 |
| 官方打印试玩包 | 该试玩范围的内容可能齐全 | 商业完整版或全部扩展都可复用 |
| 公共 GitHub 仓库 | 源码或数据可读 | 有明确复用许可、实现全部规则或可用于训练 |
| 商业数字版／桌游平台 | 存在可游玩的实现 | 提供可用训练 API、批量模拟权限或开放代码 |

本轮几个具体例子：

- **Sky Team**：出版商列出基础版 **11 个机场、21 个场景**，提供规则和 Flight Log，还有额外场景。环境仍须将棋盘格、轨道、指示物、模块、限制和胜负逐项转录，不能只做一个“轮流填骰子”的近似游戏。[官方来源](https://www.scorpionmasque.com/en/sky-team)
- **Spirit Island**：基础产品包含 **3 个敌国面板、4 个场景面板**；可按敌国/难度/精灵/地图生成评测配置，它不是必须按一条线性剧情闯关的游戏。[官方来源](https://shop.greaterthangames.com/products/spirit-island)
- **Pandemic Legacy S1**：公开规则提供非 Legacy 热身模式。做完热身只能报告热身环境完成，不能报告 12 个月战役完成。[官方规则](https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/zm7170_zm7171_rules_web.pdf)
- **资料使用范围**：Frosthaven 官方 FAQ 明确排除用于 AI/LLM 训练；公共组件库也可能有特定用途限制。因此“规则核查参考”和“可纳入训练/分发的数据”需要分别登记。[官方 FAQ](https://cephalofairgames.github.io/frosthaven-faq/)、[Worldhaven 说明](https://github.com/any2cards/worldhaven/blob/master/readme.md)

## 5. 建议的实现次序

以下按研究价值、资料完整性和工程规模提出，**不改变上面的榜单排序**；资料未齐全的项目必须先补输入，不用简化自创规则冒充官方。

1. **Sky Team**：先实现一个完整官方基础机场，验证两玩家私有观察、讨论阶段与落地判定；随后扩展官方场景。
2. **The Crew: Mission Deep Sea**：先实现经过核验的一个完整官方任务，再扩展任务库；关注三玩家信息隔离、吃墩规则和提示合法性。
3. **Spirit Island**：固定基础版、精灵与地图，完成标准对局；为非对称规划提供更复杂基准。
4. **Jaws of the Lion 教学场景**：取得完整场景输入后按教学顺序扩展；实现课程式难度增长。
5. 再根据前三类环境的复用情况扩展其余高排名候选；Slay the Spire、Marvel Champions、Arkham 等大量卡牌效果应作为明确的工程范围管理。

研究时要分开报告：按规则可验证的胜率、环境规则正确性、任务覆盖率、Agent 观察隔离，以及难度随任务变化的趋势。高 BGG 排名不能直接换算为更难的 Agent 基准。

## 6. 已形成的工程设计

[有状态 API 与训练接口设计](stateful-api-design.md)回答了后续平台问题：

- 每局保存服务端真实状态，用 `episodeId` 和座位 token 寻址。
- 每个玩家只读自己的观察，服务端校验动作和胜负。
- 事务、版本与幂等键解决同时请求和网络重试。
- 游戏适配器统一 `setup / observe / legalActions / step / outcome`，每款保留自己的规则和交流限制。
- RLVR 使用规则验证奖励；SFT 使用合法的玩家可见示范；赛后反思单独保存。
- 时间、讨论、行动、可见信息、结果与反思形成统一审计记录。

**当前状态：16 款高排名候选及 1 款机制对照已登记，接口与服务架构是设计草稿；新游戏的可交互环境尚未实现。** 机器清单中所有新条目的 `canCreateEpisode` 都是 `false`，不会把研究目录当成已运行服务。
