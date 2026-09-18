# 高排名合作桌游研究补充 C

查询日期：**2026-09-16**。本文件只做资料与可实现性调查，未实现、运行或认证这些游戏的环境。

## 1. 按 BGG 总排名筛选

以下是 BGG **总榜名次**，不是合作游戏内部序号。网站限制直接访问，因此采用搜索引擎抓取的 BGG 原站快照；“查询日期”不等于“榜单实时更新时间”。优先使用同一[合作游戏筛选榜](https://boardgamegeek.com/boardgamemechanic/2023/cooperative-game/linkeditems/boardgamemechanic?mechanicfilter=2023&pageid=1&sort=rank)；不同页面存在抓取滞后。

| 游戏 | 总榜快照 | 排名证据与滞后 | 建议研究定位 |
|---|---:|---|---|
| Sky Team | **32** | 合作筛选榜约 1 天前；[单品页](https://boardgamegeek.com/boardgame/373106/sky-team)约 5 天前也为 32 | 优先：双人、隐藏骰子、受限沟通 |
| Marvel Champions: The Card Game | **50** | 合作筛选榜约 1 天前；[总榜页面](https://boardgamegeek.com/browse/boardgame?rank=41&rankobjectid=1&rankobjecttype=subtype&sort=rank)约 1 周前也为 50 | 高排名复杂规则环境候选 |
| The Lord of the Rings: Fate of the Fellowship | **58** | 合作筛选榜约 1 天前；[单品论坛页](https://boardgamegeek.com/boardgame/436217/the-lord-of-the-rings-fate-of-the-fellowship/forums/0)约 3 天前也为 58 | 高排名空间规划合作候选 |
| Bomb Busters | **86** | 采用[合作筛选榜](https://boardgamegeek.com/boardgamemechanic/2023/cooperative-game/linkeditems/boardgamemechanic?pageid=1&sort=rank)快照；[评分页](https://boardgamegeek.com/boardgame/413246/bomb-busters/ratings?rated=1)另一约 1 周前快照为 87，保留差异 | 优先：隐藏信息推理；先补官方任务卡 |
| The Crew: The Quest for Planet Nine | **96** | [BGG 文件页](https://boardgamegeek.com/boardgame/284083/the-crew-the-quest-for-planet-nine/files)约 2 天前 | 优先：合作吃墩、结构化沟通 |
| Aeon's End | **109** | [BGG 单品页](https://boardgamegeek.com/boardgame/191189/aeons-end)约 2 天前 | 第二批：合作构筑与随机轮序 |
| Codenames: Duet | **277** | [BGG 单品页](https://boardgamegeek.com/boardgame/224037/codenames-duet)约 2 天前；更早论坛快照为 276 | 语言协作对照组；排名低于本组其他候选 |

The Crew: Mission Deep Sea 是另一款游戏，不能拿它较高的排名替代 Planet Nine。本组包含排名 277 的 Duet 是为了提供语言任务对照，不应把它宣传为本轮最高排名的优先选择。

## 2. 规则、公开关卡与可复用代码

“可公开阅读规则”“存在在线版本”“源码公开”“源码有开源许可证”“已有符合官方规则的训练环境”是不同结论。下文分别记录。

### Sky Team — 完整官方 Montréal / YUL 入门情景可行

**官方来源**

- [Scorpion Masqué 产品与下载页](https://www.scorpionmasque.com/en/sky-team)。
- [英文核心规则 PDF，12 页](https://www.scorpionmasque.com/sites/scorpionmasque.com/files/st_rules01_en_06jun2023.pdf)。包含 YUL 设置、回合流程和落地判定。
- [英文 Flight Log PDF](https://www.scorpionmasque.com/sites/scorpionmasque.com/files/st_rules02_en_06jun2023.pdf)。进阶模块与情景应单独划定实现范围。
- 官方额外情景：[Print & Play](https://www.scorpionmasque.com/Skyteam/documents/ST_Print%26Play_EN.pdf)、[Ready to Play](https://www.scorpionmasque.com/Skyteam/documents/ST_ReadyToPlay_EN.pdf)。这些不是独立于基础游戏的完整组件包。

**规则证据摘要**：两名玩家各有四颗私密骰子，交替放置；轴线和引擎有双方必放要求。规则还包括襟翼、起落架、刹车、无线电、咖啡、重掷与最终落地条件。每轮掷骰前可以讨论，但不能讨论骰值，连条件式的骰值约定也受限制。不能把讨论阶段设计成任意编码骰子的自由协议。依据为上述核心规则。

**实施判断（研究分析）**：可做完整的官方绿色 YUL 入门情景，保留所有基础操作及失败条件，而不是缩减为比较骰子总和。当前仍需将 PDF 图上的 YUL 进近格、交通飞机、重掷标记和先手标记逐格转录并交叉检查；本调查未完成图面双人复核。规则数据的人工转录是明确剩余工作，并非另创简化规则。

**环境/API**：存在[获授权的 BGA 版本](https://en.boardgamearena.com/gamepanel?game=skyteam)，但没有据此发现可公开调用的训练 API 或可再分发引擎。本轮未核实到专门、独立、宽松许可证且覆盖完整规则的 Sky Team 无界面引擎。通用虚拟桌面能摆放组件，不等于自动判定合法动作的环境。

**建议 API 与 RLVR**：`begin_round → discussion → roll_private → place_die / reroll → resolve_round`；每个代理只看到自己尚未使用的骰子。由规则引擎精确返回安全落地或失败。机制胜负可以自动核验；自然语言讨论是否违反“不能提及骰值”的规则，需要单独审计或使用明确说明的受限交流接口。

### Bomb Busters — 规则和 MIT 引擎候选存在，首任务卡待补

**官方来源**

- [Cocktail Games 产品页](https://www.cocktailgames.com/jeu/bomb-busters/)。
- [英文规则 PDF，8 页](https://www.cocktailgames.com/wp-content/uploads/2023/10/BombBusters_rules_EN.pdf)。
- [官方 FAQ](https://www.cocktailgames.com/nos-jeux/bomb-busters-faq/)。
- [公开额外任务 68–70 PDF](https://www.cocktailgames.com/wp-content/uploads/2023/10/Mission686970.pdf)。它们不是基础盒第 1–3 任务。

**规则证据摘要**：基本蓝线为 1–12 各四根；黄线、红线和使用的子集由任务确定。每张任务卡正面给设置、背面给特殊规则；规则书不能替代任务卡。双人和三人时部分玩家持两个分别排序的架子。核心动作包含合作剪线、单独剪线等。官方 FAQ 允许在满足动作条件时有意报错付出代价，因此不能一概将其判为非法动作。

**精确资料缺口**：未核实到基础 **Mission 1 任务卡正反面**的完整公开官方内容；因此其线集合、设备、信息标记、引爆刻度及任何例外仍待核对。不能凭“教学关应该没有红线”之类推测声称完整复现。公开任务 68–70 同样需要基础组件和其规则，不能当作无需补数据的捷径。

**可复用引擎候选**：[julienreichel/bomb-buster](https://github.com/julienreichel/bomb-buster)，实际检查了 [MIT LICENSE](https://raw.githubusercontent.com/julienreichel/bomb-buster/main/LICENSE)、README、代码树与部分状态代码。包含 Vue/Quasar UI、游戏状态管理及模拟逻辑，是比静态规则网页更实质的起点。不过，本轮没有核实全部官方任务覆盖；状态对象包含所有玩家线值，须另做严格的逐玩家 observation 投影，随机源也须改为可播种并做回放。不能把 README 的 AI 胜率或“完整”描述当作本调查已复现的结果。

另一搜索结果 `whme/bomb-buster` 的 GitHub API 于查询日返回 404，不列为当前可用依赖。

**建议 API 与 RLVR**：`dual_cut / solo_cut / reveal_red / use_equipment`，携带公开位置和必要声明值，服务端私下判断匹配、红线与引爆状态。隐藏值不得因合法动作列表而泄漏。补齐并审核正式任务后，可形成强确定性胜负核验；本轮状态为“值得优先实现，资料尚未齐全”。

### The Crew: The Quest for Planet Nine — 官方首任务资料较齐全

**官方来源**

- [Thames & Kosmos 英文规则 PDF，22 页](https://thamesandkosmos.com/manuals/full/691868_Crew_Manual.pdf)。
- [官方 Demo Sheet](https://www.thamesandkosmos.com/downloads/The_Crew_Demo_Sheet.pdf)。
- [IELLO 官方产品页](https://iello.fr/jeux/the-crew/)及其[公开法语 Log Book PDF，4 页](https://iello.fr/wp-content/uploads/2020/05/The-Crew_Log-Book.pdf)。末页实际包含第 1–3 任务；首任务显示一个任务目标。它不是完整 50 任务集。
- [官方 Deimos Adventure 1 PDF](https://www.thamesandkosmos.co.uk/wp-content/uploads/2020/04/The-Crew-The-Deimos-Adventure-1.pdf)，可作为另外公开的正式任务来源。

**核查陷阱**：[Kosmos 德语“Anleitung / Logbuch”支持页](https://fragkosmos.zendesk.com/hc/de/articles/8069483104412-Die-Crew-Reist-gemeinsam-zum-9-Planeten-Anleitung-Logbuch-DE-Art-Nr-691868)中的 Logbuch 附件只有记分表；不能仅凭文件名认定拿到了全部任务。IELLO 的上述四页附件才提供了前三个实际任务。

**规则证据摘要**：完整牌组为四种颜色各 1–9 加四张火箭，共 40 张。持火箭 4 者为指挥官；需遵守跟色和将牌规则。目标牌必须由分配到该目标的玩家赢得，目标完成后按规则立即判定。通信是有窗口和次数限制的公开单张牌及最高/最低/唯一标记；不能通告火箭。可选的求救信号和双人 Jarvis 规则是独立规则内容。依据为英文规则。

**实施判断（研究分析）**：先固定四人、官方 Mission 1，使用完整 40 张牌与正式任务分配、出牌、通信和求救规则，资料足以进入实现；需对任务页图标做最终视觉复核。可选求救应支持或明确配置为“玩家选择未启用”，不能伪造一种删掉后仍号称全规则的玩法。三人牌数不等和双人 Jarvis 需要另做完整测试；不应默认一个四人环境已覆盖全部人数。扩展到全 50 任务仍缺完整任务数据库。

**开源候选**：[davidnkyle/crew_mcts](https://github.com/davidnkyle/crew_mcts)，已读取 [MIT LICENSE](https://raw.githubusercontent.com/davidnkyle/crew_mcts/main/LICENSE)和部分 `game_state.py`。这是研究代码，含牌局状态、目标、MCTS 和通信相关结构。其随机目标设置不等于全部 50 个官方任务；通信时机、可选求救、任务顺序和人数变体均须按规则审计，不能直接认证为官方完整环境。[iwan382/crew](https://github.com/iwan382/crew)有作者研究实现，但 GitHub 许可证信息为空，未确认复用许可。

**API 与 RLVR**：`choose_task / communicate / use_distress_signal / play_card`，服务端管理跟色、任务所有者和胜负。适合用不同发牌种子与正式任务分割训练/测试；一次成功样本不能代替对无解或困难发牌的评估。存在 [BGA 授权版本](https://en.boardgamearena.com/gamepanel?game=thecrew)，不能据此称开源环境。

### Marvel Champions — 高排名，公开规则充分，卡牌效果执行成本高

**官方资料**：[FFG 产品支持页](https://www.fantasyflightgames.com/en/products/marvel-champions-the-card-game/)公开 Learn to Play、Rules Reference、各扩展规则与战役记录。查询时 Rules Reference 的页面日期为 **2026-07-22**；不得把旧的 1.7 版新闻当作当前最新版。另有 [Asmodee 官方 Learn to Play PDF](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2023/12/mvc01_learn_to_play_eng-compressed.pdf)。实现前应保存具体规则版本与文件校验值。

**组件/API**：[MarvelCDB API](https://marvelcdb.com/api/)公开卡牌和卡组数据访问，但它是资料库 API，不执行牌局，也不意味着卡牌文字变为开源许可。完整的 Rhino 入门对局仍需核对指定英雄、遭遇组、数量、卡面文本和强制/可选效果时机。

**引擎调查**：[frwololo/warnel-chawpiovs](https://github.com/frwololo/warnel-chawpiovs)存在自动执行规则的社区实现；README 自述包含同时行动等对原规则的调整，GitHub 许可证元数据为空。本轮没有确认可复用许可证与严格官方规则兼容性，因此不能直接选为基准后端。

**研究判断**：适合后续做长程规划、多英雄配合和动作中断的困难任务。先锁定 Core Set、正式 Rhino 标准情景、固定官方起始卡组，仍属于完整特定对局；不能删掉卡牌文本和遭遇效果来降低工程量。胜负可由精确引擎核验，真正难点是实现并测试全部相关事件时序，暂不属本组最先落地的环境。

### The Lord of the Rings: Fate of the Fellowship — 排名高，公开规则不等于完整组件数据

**官方来源**：[Z-Man 产品页](https://www.zmangames.com/game/the-lord-of-the-rings-fate-of-the-fellowship/)；[设计者 Matt Leacock 的 2025-05-14 发布说明](https://mattleacock.substack.com/p/fate-of-the-fellowship-update)直接链接[英文官方规则文件](https://boardgamegeek.com/filepage/296739/the-lord-of-the-rings-fate-of-the-fellowship-rule)。规则文件页在本轮读取中被 BGG 拒绝访问，已核实来源链，未完成其全文核读。

设计者同时说明当时 BGA 版本只有 introductory / standard 模式、部分角色和目标；那是有限范围的数字授权版本，不能当作全部实体内容的公开数据或开源引擎。

**待补数据**：地图节点与路径、初始分布、玩家及阴影牌组逐张内容与数量、选定角色能力、目标卡、事件卡、骰面分布。需要先从正式规则确定完整 introductory 设置，再逐项核对组件数据；本轮未完成这一步，也未核实可复用的开源规则引擎。

**研究判断**：合作调度、局部风险与大地图状态很适合 RLVR，但不应凭产品介绍创造一个“类 Pandemic”简化规则并用正式游戏名称汇报。建议保留为高优先级资料核对候选。

### Aeon's End — 随机轮序合作构筑；随机配套工具不是引擎

**资料**：[Indie Boards & Cards 官方页](https://indieboardsandcards.com/our-games/aeons-end/)；[BGG Final Rulebook 文件项](https://boardgamegeek.com/filepage/141295/aeons-end-final-rulebook)。当前官方页包含第二版产品信息，实施时需要明确版本，不能混用不同版的卡牌与勘误。本轮未取得并逐项核验完整的官方入门配置与组件文字。

**实际开源物**：[on3iro/aeons-end-randomizer](https://github.com/on3iro/aeons-end-randomizer)有 MIT 许可证，但其定位是非官方配局/随机化伴侣工具。它可能提供部分结构化数据，**不是**牌局规则模拟器。未核实到可直接复用且已覆盖正式首局的无界面引擎。

**待补**：锁定版本后的官方首局角色、宿敌、市场、卡牌数量和逐张效果；宿敌各阶段牌库、法术结算与选择时机。实现后可用胜利/城市被毁/全体失败等正式终局进行自动核验，并研究随机轮序下的团队资源规划。现阶段不应仅靠随机配局工具宣布已具备环境。

### Codenames: Duet — 语言协作有价值，但语义合法性不能全靠机械判定

**官方资料**：[CGE 现行产品页](https://www.czechgames.com/games/codenames-duet)及[2025 版说明](https://www.czechgames.com/for-press-games/codenames-duet)。2025 版有更新词库和规则整理，公开组件说明为 60 张双面钥匙卡；不能和早期版 100 张钥匙卡混写。旧地址 `https://www.czechgames.com/files/rules/codenames-duet-rules-en.pdf` 在查询时已重定向为其他页面，不能当作已验证可下载的当前规则 PDF。

**代码**：[jbowens/codenamesgreen](https://github.com/jbowens/codenamesgreen)含 Elm 前端、Go JSON API，是实际在线游戏实现候选，但仓库根目录没有确认到 LICENSE，不能默认拥有再分发许可。[MIT 钥匙生成器 gist](https://gist.github.com/DenverCoder1/7c14515e1f09fca72e49486a1a1d2c37)只解决相关联钥匙的生成，不是完整牌局引擎。

**待补**：确定采用 2017 版或 2025 版、取得对应官方完整规则及词库来源，核对双面钥匙关系、回合/失误额度、刺客和突然死亡规则。

**RLVR 边界（研究分析）**：猜中/误猜/刺客/回合耗尽可以严格计算；提示词是否与词义有关、是否在用位置或其他暗号传递信息，无法仅靠牌面状态做到可靠自动裁判。应将“机械胜负奖励”与“语义规则合规审计”分开，报告后者的人类或模型裁判误差。适合作为语言合作对照，不宜称为完全自证合法性的纯规则奖励任务。

## 3. 当前建议与交付边界

1. **先从高排名里选**：本组优先 Sky Team（32）；Marvel Champions（50）与 Fate of the Fellowship（58）保留为难度更高的候选，不因工程量大就从调查名单排除。
2. **首批可做完整特定关卡**：Sky Team 的 YUL；The Crew: Planet Nine 的四人 Mission 1。仍需转录/复核少量官方图面数据，并实现所有适用基础机制。它们的首关容易，不意味着可将删规则的版本替代正式首关。
3. **有希望但尚欠关键资料**：Bomb Busters 的正式 Mission 1 卡正反面。MIT 模拟器是加分项，不能补造缺失的官方任务数据。
4. **原型代码和训练基准分开验收**：至少需要逐玩家 observation、合法动作不泄密、确定随机种子、可重放事件记录、正式终局判定、规则边界测试；共享的全局状态不能直接喂给各代理。
5. **许可证分层记录**：游戏规则及组件、程序代码、第三方卡牌数据库分别登记来源与许可。MIT 程序许可证不会自动授权再分发原游戏插画、卡牌正文或整本关卡册。

本调查给出了七款有排名证据的候选、主要官方来源及明确缺口。没有把“公开能玩”写成“开源可训练”，没有声称任何环境已实现或已通过官方规则认证。
