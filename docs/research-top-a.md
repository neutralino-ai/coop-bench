# 高排名合作桌游来源核对 A

查询日期：**2026-09-16**。本报告只做候选筛选与来源核对，不实现游戏。

## 1. 排名依据与版本

以下是 BGG **总榜 Overall** 的检索缓存快照，不是实时排名。BGG 页面直接访问有时返回 403，因此使用搜索引擎抓取的 BGG 原站页面；“抓取时间”是搜索结果显示的相对时间，不是排名最后变动时间。

| 游戏与锁定版本 | BGG 总榜快照 | BGG 原站证据 | 结果显示的抓取时间 |
|---|---:|---|---|
| Pandemic Legacy: Season 1（2015） | 3 | [游戏页](https://boardgamegeek.com/boardgame/161936/pandemic-legacy-season-1) | 1 天前 |
| Gloomhaven（2017 原版） | 4 | [游戏页](https://boardgamegeek.com/boardgame/174430/gloomhaven) | 1 天前 |
| Spirit Island（2017 基础版） | 11 | [游戏页](https://boardgamegeek.com/boardgame/162886/spirit-island) | 约 2 周前 |
| Gloomhaven: Jaws of the Lion（2020） | 12 | [BGG 图片子页，页头包含总榜排名](https://boardgamegeek.com/boardgame/291457/gloomhaven-jaws-of-the-lion/images) | 3 天前 |
| Frosthaven（2022） | 20 | [游戏页](https://boardgamegeek.com/boardgame/295770/frosthaven) | 约 2 周前 |

这五款符合优先筛选高排名合作桌游的方向。Gloomhaven、Jaws of the Lion、Frosthaven 属于同一机制家族；可以分别研究，但后续报告应披露其关联，不能把三者当作三个完全独立的机制样本。

## 2. 每款的官方资料、最小范围与缺口

### 2.1 Pandemic Legacy: Season 1

**最直接官方来源：**[Z-Man／Asmodee 官方规则 PDF](https://cdn.svc.asmodee.net/production-zman/uploads/2024/09/zm7170_zm7171_rules_web.pdf)。另有[设计者 Matt Leacock 的游戏介绍](https://www.leacock.com/pandemic-legacy)。

**已核实：**规则 PDF 第 3 页明确提供不使用 Legacy 内容的热身玩法：忽略月份、Legacy 牌组、档案、目标、资金、日历、恐慌等级、伤疤和局末升级，以治愈四种疾病为胜利目标。正式战役跨 12 个月；失败后同月可重试一次，第二次后推进。Legacy 牌组保持顺序，停止牌控制解锁；档案、贴纸、封包和后续新增规则均属于战役状态。

**最小可实现范围：**官方认可的单局热身模式，固定角色、难度与随机种子。它可以作为合作规划测试，但必须标为“Season 1 规则提供的热身玩法”，**不能称为已实现 Legacy 战役**。实施前仍需核验完整城市图、初始角色能力、事件和牌组清单。若研究重点是 Legacy，应先补齐一月份目标与触发数据，再判断能否支持完整的一月份。

**公开关卡与缺失：**公开规则书不是完整 12 个月任务库。本轮未核实官方完整公开的 Legacy 牌序、档案、封包内容及其可复用授权；不能从规则 PDF 推断这些内容已具备。

**可复用代码：**[GAIGResearch/TabletopGames](https://github.com/GAIGResearch/TabletopGames) 是 MIT 许可的 Java 桌游 AI 框架，包含 Pandemic 相关实现与通用代理接口。需要逐项对照基础版规则；它不等于 Pandemic Legacy 引擎，不能补齐战役数据。

**RLVR 判断：**单局胜负、爆发次数、疾病方块与牌堆耗尽可用程序判定。合作行动规划和随机牌堆适合评测；完整 Legacy 则新增跨局持久状态、解锁与规则变化，工作量显著增加。

### 2.2 Gloomhaven（2017 原版）

**最直接官方来源：**[Cephalofair 游戏页](https://cephalofair.com/pages/gloomhaven)。**版本警告：该官网当前提供的是 2025 第二版内容**；其链接文件标题为 [Gloomhaven-2025-Rulebook.pdf](https://drive.google.com/file/d/16TmmCKa6zVVObj2qM-vIj9RcEAC3nfMT/view?usp=sharing)。不能把这份规则直接用于 BGG 排名第 4 的 2017 原版。

**原版资料状态：**[公开原版规则阅读器](https://online.flippingbook.com/view/598058/) 可读到原版规则内容，本轮未完成其当前托管链路与出版商原始发布链接的对应核验，应视为待确认的旧版公开副本。其内容包括每轮选择两张行动牌、使用一张上半部与另一张下半部、先攻、怪物行动、疲劳，以及单独列出的开放信息变体。正式环境必须固定原版规则与勘误版本，并保留原本的信息交流限制。

**公开场景线索：**[BGG 场景索引](https://boardgamegeek.com/wiki/page/thing%3A174430%3AScenarios) 将 Official Demo Scenario 和设计者 Isaac Childres 的十场景 Into the Unknown 列为官方额外场景。此索引是社区整理，不能代替出版商授权。本轮核实了索引中的官方作者归属线索，**尚未逐项核实原始场景 PDF、完整地图和组件清单**。

**最小可实现范围：**优先核验并实现一个完整官方 Demo 场景；也可选择基础战役第 1 场景 Black Barrow，但必须取得并核对完整地图、胜利条件、初始角色牌、怪物牌与属性。截取“第一房间”可用于工程测试，不能当作完成一个官方场景。

**规则难点与缺失：**怪物锁定目标、移动路径、视线、攻击范围、异常状态、元素、召唤物和卡牌例外；完整卡牌文本与地图授权仍待核验。当前官网第二版资料不能自动弥补原版缺口。

**RLVR 判断：**场景胜负及动作合法性可验证，适合合作战术与有限交流研究；需要完整实现战斗与牌面效果后才可作为可信裁判。公开场景不是独立可运行游戏，仍依赖基础组件。

### 2.3 Gloomhaven: Jaws of the Lion

**最直接官方来源：**[Cephalofair 产品页](https://cephalofair.com/products/gloomhaven-jaws-of-the-lion)、[官方套装介绍](https://cephalofair.com/collections/jaws-of-the-lion/products/jaws-of-the-lion-complete-bundle-1)、[设计者关于教学设计的文章](https://cephalofair.com/blogs/chronicle/thoughts-on-the-old-year-2019)。出版商确认这是独立合作游戏，使用场景书作为地图，包含渐进教学；设计者明确讨论前五个教学场景。

**规则与场景资料状态：**本轮未核实当前出版商直接托管的 Learn to Play、Glossary 和完整 Scenario Book 下载链接。已找到[Learn to Play 公开镜像](https://comparajogos-forum.s3.dualstack.sa-east-1.amazonaws.com/uploads/original/2X/4/4fa955cfc800988418e907f4f97ff4859a270130.pdf)和[Glossary 公开镜像](https://comparajogos-forum.s3.dualstack.sa-east-1.amazonaws.com/uploads/original/2X/e/e6fb769d1c8b7730e40cbe95d93c641ed83638c0.pdf)，但它们是第三方托管，原始发布来源与复用权限待补；不能将其标成出版商官方下载。

**最小可实现范围：**教学场景 1，再扩展到 1—5 的渐进课程。所需数据包括各教学阶段规则、场景地图、教学用角色牌、怪物属性与胜利条件。**规则书可读不代表这些输入已经完整**；本轮没有确认全部 25 场景的数据就绪。

**规则难点：**教学场景逐步开放规则，需要给每个场景固定规则集；不能第一关就启用完整版所有机制，也不能套用 Frosthaven 的更新规则。进入正式规则后仍有目标选择、路径、视线和大量牌面效果。

**RLVR 判断：**是这三款 Haven 游戏中较好的首个环境候选：教学关可以逐级增加动作复杂度，场景目标可程序判定。推荐属于工程适配性判断，不表示其完整素材已可公开再分发。

### 2.4 Frosthaven

**最直接官方来源：**[Cephalofair 游戏页与勘误](https://cephalofair.com/pages/frosthaven)、[官方 FAQ](https://cephalofairgames.github.io/frosthaven-faq/)。FAQ 页面标注更新至 2026-07-14；官方产品资料描述一个大型场景战役与据点发展系统。

**公开规则与场景：**[Worldhaven 的 Frosthaven 书籍目录](https://github.com/any2cards/worldhaven/tree/master/images/books/frosthaven) 可浏览规则书、入门指南、分段场景书、段落书、谜题书等文件。这证明有公开可读副本，**不证明有适用于本项目的自由复用许可**。完整组件覆盖率及其版本尚未逐项审计。

**最小可实现范围：**优先核验官方教学场景 0，使用初始角色与低等级配置，完整实现其场景目标；暂将据点和长战役作为后续范围。具体场景输入与组件需先核对，并确认使用方式的许可。官方 FAQ 将场景 0—1 列入非剧透范围，这也不等于授予复用权。

**明确限制：**官方 FAQ 明文拒绝将该文档用于 AI 或 LLM 训练；应保留为规则核对来源，不能因为能浏览就将其纳入训练语料。Worldhaven 的用途许可限制见下一节。

**规则难点：**相对 Gloomhaven 的目标选择和规则调整、战利品与资源、角色效果、段落解锁、季节、建造与据点事件。只实现战斗场景不等于完成整个战役系统。

**RLVR 判断：**战斗场景可提供明确胜负与高难度合作规划；完整战役增加持久状态和长时间依赖。更适合作为后续高难度目标，工程启动成本高于 Jaws of the Lion 教学关。

### 2.5 Spirit Island

**最直接官方来源：**[Greater Than Games 产品页](https://shop.greaterthangames.com/products/spirit-island)，其提供[官方 CORE Rulebook 下载链接](https://www.dropbox.com/scl/fi/5wzghwnbsi39msyy6vvox/Spirit-Island-CORE-Rulebook.pdf?dl=0&rlkey=86i7aofqbzhulezjr7z0ssyff&st=iqv6wpml)。本轮确认出版商到该 PDF 的链接关系；Dropbox 阅读器未返回可完整核对的正文，因此详细条款仍需后续逐页核验。另有[设计者维护的 FAQ／出版资料索引](https://querki.net/raw/darker/spirit-island-faq/~%2BExpansions%2C%2BPromos%2C%2Band%2BPublishing)。

**公开内容与缺失：**官方基础产品有八名精灵、四块岛屿板、敌国和场景，以及能力、恐惧、入侵等牌组。规则 PDF 不能替代全部精灵面板、完整牌面和岛屿邻接数据。官方 FAQ 索引也提供过部分促销精灵的打印资料，但那不是完整基础游戏数据集。设计者的 Apocrypha 资料须与正式基础版区分。

**最小可实现范围：**基础版标准合作对局，先固定两名低复杂度精灵、平衡地图板，不启用敌国和额外场景；按正式规则完成整局胜负判定。Spirit Island 无需线性战役也可生成研究实例，但仍必须补齐基础牌组效果和地图数据。本轮未核验这些输入的完整公开复用来源。

**代码线索：**[spiritislandweb](https://github.com/maddinpsy/spiritislandweb) 标注 MIT，使用 React 与 boardgame.io；README 展示拖放和计数器等功能，未证明已经完成所有规则、合法动作和自动结算，素材许可也需另查。[Tabletop Simulator 模组](https://github.com/spirit-island/spirit-island-mod) 的可复用许可证未核实。[Handelabra 数字版](https://www.handelabra.com/spiritisland) 是商业实现来源，不等于开放的环境 API。

**RLVR 判断：**很适合非对称合作、空间规划、资源管理与快慢能力协调；胜负、合法目标和状态变化可程序验证。主要成本是完整能力效果、选择顺序与卡牌例外。不能用大模型的主观评价代替规则裁判。

## 3. Haven 家族可复用项目与许可证边界

| 来源 | 已核实情况 | 可用于本项目的判断 |
|---|---|---|
| [Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat) | TypeScript／Angular，AGPL-3.0；支持多款 Haven 游戏的记录、怪物、牌堆与场景辅助 | 可以研究数据结构与辅助逻辑；未核实是完整自动执行环境。代码许可证与游戏素材授权须分别处理 |
| [X-Haven Assistant](https://github.com/Tarmslitaren/FrosthavenAssistant) | Dart／Flutter，AGPL-3.0；多版本战斗助手 | 可参考规则辅助与状态管理；不能直接宣称具备完整动作空间与裁判 |
| [Gloomhaven Full Stack](https://github.com/tsmigiel/gloomhaven-full-stack) | 网络记账与地图工具；README 承认部分特殊场景规则不完整 | 本轮未核实许可证，不列为已经可复用的完整开源环境 |
| [Worldhaven README](https://github.com/any2cards/worldhaven/blob/master/readme.md) | 作者说明持有个人协议，并限制素材用于其指定的浏览器辅助与论坛游戏等用途，其他用途不获自动授权 | 不是通用开放组件数据集；本项目的训练、分发或其他集成用途不能从仓库公开性推出授权 |
| [Creator Pack 原发布线索](https://boardgamegeek.com/thread/1733586/files-for-creation) | Secretariat README 将相关素材标为 CC BY-NC-SA 4.0；本轮未完整读取原帖确认具体覆盖范围 | 原始许可与文件范围待核；不能推广为全部已有卡牌、场景和书籍的统一许可 |

## 4. 当前可审阅结论

1. **排名筛选完成：**五款在已核实 BGG 总榜缓存中的名次分别为 3、4、11、12、20，足以进入高排名合作桌游候选表。
2. **规则来源与任务数据应分开登记：**本轮可直接确认的第一方资料最完整的是 Pandemic Legacy 规则 PDF、Frosthaven 官方 FAQ 与勘误，以及 Spirit Island 出版商规则下载入口；Gloomhaven 原版与 Jaws 的旧版官方 PDF 链路仍有待补项。
3. **没有把任何一款标成“完整公开任务数据与许可均已就绪”。**公开 PDF、公开 GitHub 仓库、可游玩的商业数字版是三种不同证据。
4. 若下一步开始搭环境，可优先比较 **Jaws 教学场景**与 **Spirit Island 基础配置**；这只是候选工程范围。Pandemic Legacy 热身模式的范围较小，但不能替代用户若真正要研究的 Legacy 机制。完整 Frosthaven／Gloomhaven 战役宜后置。
5. 下一轮只需针对最终入选游戏补齐版本固定、完整组件清单、官方场景输入、使用许可与可执行规则覆盖表，无需现在追齐所有候选的整个战役。
