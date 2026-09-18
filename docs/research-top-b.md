# 高排名合作桌游研究 B：五款候选

查询日期：**2026-09-16**。本文件仅做资料、代码覆盖和许可初审，未安装运行候选仓库，未宣称已经完成任何环境。

## 排名与研究结论

排名取 [BGG 合作机制筛选页](https://boardgamegeek.com/boardgamemechanic/2023/cooperative-game/linkeditems/boardgamemechanic?mechanicfilter=2023&pageid=1&sort=rank) 的近期搜索抓取快照；这是 **BGG 总榜位置**，不是合作游戏内部名次，也不是实时排名。《死亡湮灭》另外核对了 [BGG 游戏页的抓取快照](https://boardgamegeek.com/boardgame/253344/cthulhu-death-may-die/files)。

| 游戏 | 总榜快照 | 官方规则 | 官方任务/场景 | 足以完整执行的组件数据 | 可复用环境初审 |
|---|---:|---|---|---|---|
| Slay the Spire: The Board Game | 15 | 有，v2.30；另有出版商 PDF | 标准 Act 1 可作完整最小冒险；不是固定剧本 | 官方 App 有全卡图鉴；未找到官方开放结构化数据集 | GPL-3.0 单角色单战斗 MVP，缺多人和完整冒险 |
| Arkham Horror: The Card Game | 33 | 有；需要锁定核心盒/FAQ 版本 | 官方完整 Night of the Zealot 战役指南 | 社区 ArkhamDB JSON 有核心盒玩家牌和遭遇牌；许可未明确 | 大型真实规则引擎存在，但未找到通用代码 LICENSE |
| Too Many Bones | 37 | 有；官方另提供角色和敌人技能参考 | 完整遭遇和暴君设定主要在实体组件 | 未找到官方完整遭遇、战利品、敌人和骰面机器数据 | 未找到经核实、许可明确且忠实规则的完整环境 |
| The Crew: Mission Deep Sea | 45 | 有，24 页 | 找到前两任务日志预览；**未找到出版商公开的完整航海日志** | 40 张出牌规则可重建；社区有 96 条任务 JSON，仍需逐张校验 | MIT 多人 TS 引擎，明确缺若干规则和完整日志战役 |
| Cthulhu: Death May Die | 54 | 有，基础盒 20 页 | 场景细则在 Episode 卡；规则书不包含全套场景组件 | 未找到官方完整地图、牌面与技能数据集 | 有 Python 实现与 TTS 脚本；未找到通用许可，覆盖未充分验证 |

**就这五款而言，优先做《The Crew: Mission Deep Sea》的 3–5 人官方任务子集；Slay the Spire 可先借鉴现有战斗核心；Arkham 适合作为复杂长期目标。Too Many Bones 和 Death May Die 暂先补齐组件证据。** 这是实现难度判断，不改变按高排名选题的原则。

“公开可读”与“有明确再使用许可”分开记录。仓库代码许可不能自动覆盖商业桌游的规则文本、卡牌文本或美术；本次初审不对其作法律定论。没有找到某资料，表示本次检索未发现，不表示它不存在。

## 1. Slay the Spire: The Board Game

### 官方资料与最小范围

- [出版商产品页](https://contentiongames.com/games/slay/)；[Asmodee 官方产品页](https://www.asmodee.ca/en/product/slay-the-spire/)。确认这是 1–4 人合作桌游，不能用电子游戏环境替代。
- [官方分销渠道规则书 v2.30](https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2025/12/Slay_the_Spire_-_Rulebook_v2.30_Reprint_Web.pdf)，搜索抓取可读取；本次 PDF 直接打开出现服务错误。[出版商另一份规则 PDF](https://contentiongames.com/_images/STS_KS_Rulebook.pdf) 可作为交叉参考，不能未经比较就假定版本完全相同。
- [官方 Companion App 入口](https://contentiongames.com/sts-app/)；[开发商 App Store 页面](https://apps.apple.com/ca/app/slay-the-spire-tbg-companion/id6498383481) 明确有全卡图鉴，包括玩家牌、事件、物品、敌人等。这是公开查阅来源，**不是已获取的开放 JSON/API 或代码环境**。

建议最小完整官方范围：**基础盒 Act 1、固定 Ironclad + Silent、无额外 Ascension**。官方允许在任一 Act 结束时结束冒险，故 Act 1 可以有正式胜利终点。若只实现 Ironclad 对一个普通敌人的战斗，应标为“官方规则战斗切片”，不能称完整 Act 1。

### 真实代码与缺口

- [leothinker/slay-the-spire-the-board-game](https://github.com/leothinker/slay-the-spire-the-board-game)：根及 core 包有 GPL-3.0 许可。README 明确是 **Ironclad 对 Cultist / Jaw Worm 的单场遭遇 MVP**，TS/Vue；`apps/core/src/sts/` 为核心。作者报告 34 项单测，本次未运行。缺多人协同、完整地图、事件、商店、Boss 和完整牌池；不是完整桌游模拟器。
- [Matt41531/SlayTheSpireReference](https://github.com/Matt41531/SlayTheSpireReference)：MIT，卡牌参考工具，**不是玩法引擎**；本次未逐张核对牌库完整性。
- [ewfuentes/sts_bot](https://github.com/ewfuentes/sts_bot)：确有 Rust 模拟器、Python 训练目录及 card/event/monster/relic 数据模块，值得后续专项审查；本次未找到通用 LICENSE，未验证完整规则、多人与训练可用性，暂不列为可直接复用环境。
- [LuaViper/StSBoardGame](https://github.com/LuaViper/StSBoardGame)：Godot 项目和原型文件存在，但未找到明确通用代码许可；不能由“有源码”推断可自由再发布。

**待补数据**：所选版本的初始牌、升级面、敌人行为、事件、奖励、遗物、药水及地图规则的逐项结构化清单；官方 App 图鉴可用作人工核验入口。仅凭 24 页规则书不足以填满这些表。

### 状态机与训练价值

建议拆成 `地图选点 → 房间设置 → 玩家行动/反应效果队列 → 敌人结算 → 奖励/升级 → 下一个房间 → Act Boss/终局`。多人行动顺序与触发效果不能照搬电子游戏。适合资源分配、牌组构筑、合作组合技与跨战斗规划；规则文字执行和大量牌效是主要成本。随机种子、可重放效果队列与角色观察接口应先于训练接入。

## 2. Arkham Horror: The Card Game

### 官方资料与最小范围

- [FFG 官方产品与下载页](https://www.fantasyflightgames.com/en/products/arkham-horror-the-card-game/) 提供 Learn to Play、Rules Reference、FAQ、起始牌组和战役资料。页面同时出现 2026 新核心盒资料，必须明确版本，避免混用旧核心盒和新内容。
- [Night of the Zealot 官方完整战役指南](https://images-cdn.fantasyflightgames.com/filer_public/8d/30/8d308b73-92f1-4b1e-aa7f-ce39e8d79786/night_of_the_zealot_campaign_guide.pdf) 为 8 页，给出三幕场景设置、决议和战役衔接；**这份指南不代替场景牌和玩家牌**。

建议最小官方范围：**2021 Revised Core 内容的 The Gathering，标准难度，固定两位调查员和官方起始牌组**，锁定 FAQ 版本。完成所有场景结局与调查员死亡/精神创伤等终局路径；先独立场景，随后扩为完整三幕 Night of the Zealot。不能把“获胜/失败”压成单个指标后丢掉场景决议。

### 数据与实际环境

- [Kamalisk/arkhamdb-json-data](https://github.com/Kamalisk/arkhamdb-json-data) 是真实社区数据仓库；核对了 `pack/core/core.json`、`core_encounter.json`、`rcore.json` 及独立 `core_2026*.json` 路径。它有牌面字段和 schema，适合作为数据核对入口；本次未找到根 LICENSE，不能标为已有明确开放数据许可。尚未对 The Gathering 所需牌逐张做闭包检查。
- [halogenandtoast/ArkhamHorror](https://github.com/halogenandtoast/ArkhamHorror) 是真实、相当广泛的非官方规则执行器，Haskell 后端、Vue 前端、PostgreSQL；README 列出已完成 Night of the Zealot 等多个战役，并提醒仍可能有缺陷。支持多人和多调查员控制，带回放相关代码。
- 检查仓库树及 `backend/arkham-api/package.yaml` 后，**未找到通用代码 LICENSE 或该包的 license 声明**；找到的两个 LICENSE 是前端音效专用，不能外推到整个工程。牌图来自额外资源，也不能由代码仓库公开推断牌图授权。

结论：它是五款中已有实现最深入的候选之一，但本轮只能归为“真实现成实现，许可与正确性仍待审”，不能写成“MIT 完整环境，可以直接复制”。

### 状态机与训练价值

需要 `神话阶段 → 调查阶段（行动/技能检定）→ 敌人阶段 → 整备阶段`，另以事件队列处理强制效果、反应窗口、攻击时机、地点揭示与 act/agenda 推进。场景终局写入结构化 resolution，而不是只留胜负。

适合长期合作规划、分工、危险管理、私有手牌下的信息协作与工具调用；公开信息多，限制不应擅自套用 Take Time 的禁言。实现成本高，主要在牌效时机和场景专属逻辑；先做固定场景和固定牌组能显著缩小验证面。

## 3. Too Many Bones

### 官方资料与最小范围

- [Chip Theory Games 官方产品和下载页](https://chiptheorygames.com/products/too-many-bones)：附规则书、Baddie Skills Reference、Gearloc Adventuring Reference Guide，以及 Patches、Boomer、Picket、Tantrum 参考表等。
- [该页链接的官方规则书下载](https://www.dropbox.com/scl/fi/mwe9nv6bb68gtkkhgx04o/TMB-Rulebook.pdf?dl=0&e=1&rlkey=1y2zxkqw7mpi98aljmaoipjzq)。本次确认下载入口，但浏览器文本解析未读出完整 Dropbox PDF，因此未给出未经核验的“第几页教学关卡”。

建议最小范围是**基础盒、固定两名 Gearloc、固定一个暴君的完整冒险**；必须先取得所选暴君卡、对应遭遇、角色骰与敌人数据。当前还不能把任何命名教学关卡列为“全部素材已获取”。如果只做一个固定战斗，则明确标“战斗规则切片”。

### 组件数据与现成代码

官方规则和参考表主要解释通用机制；实体盒还包括大量遭遇、战利品、暴君牌、敌人芯片和专用技能骰。**本次未找到官方公开且完整的机器可读组件集**。公开的 Liberation Logbook 等辅助资料不等于全套遭遇牌。

- [npow/too-many-bones](https://github.com/npow/too-many-bones)：有真实 JS 战斗/敌人 AI/遭遇代码，但作者称受桌游启发的 solo fan game；README 所列简化规则与内容不能当官方实现证据。未找到通用 LICENSE，排除为直接的官方环境基座。
- [alucardu/TooManyBones](https://github.com/alucardu/TooManyBones)：TTS 脚本候选，未找到通用 LICENSE；未证明能无人工裁判执行完整规则。
- [alexe-dev/tmb](https://github.com/alexe-dev/tmb)、[Onesiphorus/TMBCompanion](https://github.com/Onesiphorus/TMBCompanion)：辅助工具候选，不能因有应用界面就列为玩法执行器。

结论：**未找到经核实、明确开源许可、忠实官方规则的完整环境**。这项判断限于本次检索，不是证明全球不存在。

### 状态机与训练价值

建议 `新的一天 → 遭遇选择 → 战斗设置/先攻 → 角色与敌人回合 → 奖励/训练 → 恢复 → 下一天或暴君 → 终局`。角色技能、骨头结果与 Backup Plan 需要独立效果系统；敌人技能和目标选择要确定化。适合角色协作、风险与骰子资源管理、跨遭遇成长规划。数据不完整时切勿自行编造遭遇或骰面后仍称官方。

## 4. The Crew: Mission Deep Sea

### 官方资料：规则书、日志、任务卡是三件不同的东西

- [Thames & Kosmos 官方产品页](https://thamesandkosmos.com/products/the-crew-mission-deep-sea)。
- [官方英文规则书，24 页](https://www.thamesandkosmos.co.uk/wp-content/uploads/2021/02/691869_Crew_Deep-Sea_Manual.pdf)；[美国官方镜像](https://www.thamesandkosmos.com/manuals/full/691869_Crew_Deep%20Sea_Manual.pdf)。足以核对跟牌、潜艇将牌、任务分配、声纳和特殊人数规则，但只含任务示例与说明，**没有逐张列全 96 张任务卡**。
- [官方 Demo Sheet](https://www.thamesandkosmos.com/downloads/The_Crew_Mission_Deep_Sea_Demo_Sheet.pdf) 是教学辅助，仍依赖任务与日志，不是完整独立 PnP。
- [Kosmos 官方德文支持页](https://fragkosmos.zendesk.com/hc/de/articles/8069448359196-Die-Crew-Mission-Tiefsee-Anleitung-DE-Art-Nr-680596) 提供说明书；本次未在该页发现完整日志附件。
- [前两任务的德文日志预览 PDF](https://gamers-hq.de/media/pdf/07/f0/a4/Die-Crew-Mission-Tiefsee-Logbuch-Teaser-mit-zwei-Missionen.pdf)：共 5 页，零售商托管，含日志说明和任务 1、2。它是日志预览，**不是完整日志，且托管方不是出版商**。文本提取无法可靠定位图标与难度数字的对应关系，这一点仍待图像核验。

重点结论：**本次未找到出版商公开提供的完整航海日志。不能把 24 页 Manual、两任务 Teaser 或社区任务 JSON 写成“官方完整 logbook 已获取”。**

### 完整可执行数据到哪一层

- 通用出牌牌组可由规则重建：四色 1–9，加四张潜艇，共 40 张。
- 96 张任务卡每张有条件和 3/4/5 人难度值；完整执行还需要每个条件的成功/不可达判定，而不只是自然语言句子。
- [sn2b/the-crew-mission-creator 的 classic.json](https://github.com/sn2b/the-crew-mission-creator/blob/main/missions/classic.json) 实际计数为 **96 条、96 个唯一 ID**，含任务文字和人数难度；这是真实社区转录，不是官方数据库，仍需逐张对照印刷组件或获授权资料。它不包含官方日志全部剧情任务和特殊规则，也不是玩法引擎。
- 该项目 README 称 MIT，但实际 [LICENSE](https://github.com/sn2b/the-crew-mission-creator/blob/main/LICENSE) 是 **GNU GPL v3**。初审按许可证原文记录 GPL-3.0，并保留这一冲突；不能引用 README 就标 MIT。

### 可复用的真实环境

1. [FredeAlexandre/crew](https://github.com/FredeAlexandre/crew)，[MIT LICENSE](https://github.com/FredeAlexandre/crew/blob/main/LICENSE)：有 3–5 人可玩实现，TS 纯规则包 `packages/engine`、协议包、按座位投影的观察包；已有任务分配、distress、sonar 和 trick 流程。原作者明确将 **官方规则标为仍在补齐**：[问题 #7](https://github.com/FredeAlexandre/crew/issues/7)，包括双人 Tonoja、部分发牌/重试边界及 distress 日志。README 明确完整 campaign 和忠实出版商 logbook 不在 V1 范围。适合作为部分基座，不能称完整官方战役；本次未运行其测试。
2. [epulick/crewbot](https://github.com/epulick/crewbot)，[MIT LICENSE](https://github.com/epulick/crewbot/blob/main/LICENSE)：真实 Python 可行性检查器，有 `mechanics.py`、`solver.py`、`tasks.yaml` 等。它的定位是任务可行性分析，**不是已验证的受限观察多智能体玩家环境**；任务覆盖和求解假设仍待审。

### 最小范围、状态机与研究适用性

建议从 **3 人或 4 人、前两项官方日志任务、经逐张核实的任务卡子集** 开始；日志难度图标和任务卡池核验完成前，不宣称这两个官方任务已完整复现。如果先用任意固定任务组合，应标“按官方基础规则选取的研究任务”，不要冒充完整官方航海日志。

建议状态机为 `发牌/确定船长 → 抽取任务 → 依规则轮流分配 → 求救信号处理 → 声纳窗口 → 按次序出牌/跟牌 → 赢墩及任务检查 → 终局/重试`；特殊任务可能改变阶段或通讯权限，应以数据驱动规则覆盖，而非写死通用流程。只能向智能体提供自身手牌及合法公开信息；工具必须拒绝不合法跟牌与不合法声纳。自由文本讨论权限按官方规则处理，不能默认允许像一般合作游戏那样报手牌。

这五款里，它最适合研究受限通信、他人意图推断、任务分配与长期协调；有限牌组也便于可重放、反事实分析和全知上界比较。全知可行性上界不能等同于玩家凭当时私有观察可达到的策略成绩。

## 5. Cthulhu: Death May Die

### 官方资料与最小范围

- [CMON 基础盒官方规则书，20 页](https://resources.cmon.com/DMD_Rulebook_web.pdf)。这份是基础游戏，不要混用后来的 Fear of the Unknown 或标为 WIP 的新季规则书。
- 规则明确以一个 Episode 盒与一个 Elder One 盒组合。每局需要二者共 16 张 Mythos、该 Episode 的 15 张 Discovery、Episode 正反面设置、敌人参考、古神阶段及调查员/疯狂组件。**规则书对这些有示例，但不是全套组件数据库。**

建议最小官方范围：**基础盒 Season 1 Episode 1 + 固定一个基础盒古神 + 两名固定调查员**。这是明确的范围建议，尚不代表所需每张牌面和地图数据已取得。要保留破坏仪式、古神召唤与最终击杀的不同阶段，不能只做普通敌人战斗就称完整 Episode。

### 真实代码、数据和缺口

- [agnlopes/cthulhu-solo](https://github.com/agnlopes/cthulhu-solo)：真实 Python 项目，包含 `season1_episode1.py`，`s1ep1.yaml`、敌人/古神/技能/调查员 YAML 与地图文本。这比只有截图的演示更值得检查，但本次未运行，未验证所有牌效和胜负路径；**未找到通用 LICENSE**，所以列为源码可见的候选，而非许可已确定的开源完整环境。
- [Trindall 的 TTS Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=2118293819&searchtext=)：作者展示完整组件和自动设置等脚本。TTS 设置自动化不等于自动规则裁判，不是可直接训练的无界面环境；未找到明确的通用源码/素材再使用许可。
- [rjutha/Cthulhu-Death-May-Die-Dice-Distributions](https://github.com/rjutha/Cthulhu-Death-May-Die-Dice-Distributions)：骰子概率工具，不能替代游戏引擎。

待补：Episode 1 地图邻接与特殊规则、所选古神各阶段、两组 Mythos、15 张 Discovery、选定调查员技能升级与疯狂卡，以及骰面的准确分布。**未找到官方完整机器可读组件集；社区候选的数据也未完成逐项官方核对。**

### 状态机与训练价值

可按 `三次行动 → Mythos → 调查或敌人攻击 → 回合结束效果 → 古神推进/召唤 → 下一人` 搭框架，效果队列处理重掷、疯狂阈值、技能升级、死亡和仪式被打断。地图用房间邻接图即可，不必先做 3D。

适合团队路线规划、风险与骰子资源管理、技能协同；私人信息不是主要难点，随机性和事件时机更重要。与 The Crew 应作为不同类型的合作测试，不能用同一种禁言制度强行统一。

## 后续最短核验清单

1. 固定每款游戏的版本、玩家数、角色和最小官方场景后，列出所需组件闭包；缺一项就明确标记，不能靠自编内容补齐后继续称官方。
2. 首先审查 Crew MIT 引擎的规则覆盖与信息投影，逐张核对将使用的任务卡；完整日志另行获取，不把社区任务生成器当成官方战役。
3. Slay 先验证现有单战斗 MVP 与规则 v2.30 的差异，再决定是否扩为双人 Act 1；官方图鉴可查阅不等于可直接批量导入。
4. Arkham、Death May Die 的源码候选先厘清许可与组件来源，再决定复用代码、仅参考结构或自行实现。
5. 所有候选本轮仅做覆盖初审。没有 clone、运行验证或完成逐牌审查的项目，不使用“完整支持官方规则”措辞。
