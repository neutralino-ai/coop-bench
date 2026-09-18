# 13 款候选的规则与组件准入

核查日期：2026-09-16。按已选定的 Sky Team → The Game 顺序核查；排名沿用此前快照，本轮没有伪造新的实时排名。

准入要求是：**规则能核实、该范围所需牌面/地图/任务能确定、能按原规则从开局走到终局。** 有编号任务的游戏按可核实的具体任务实现；普通随机开局不虚构成“第 1 关”。只找到规则书标题或网店简介不算资料完整。

## 实现范围

下列范围对应环境的实际 `scenarioId`，以 `/games` 返回的注册表为运行依据。完整战役、扩展和未知牌面不自动纳入。

| 顺序 | 游戏 | 本轮范围 | 规则与组件证据 | 说明 |
|---:|---|---|---|---|
| 1 | Sky Team | YUL 教学航线，2 人 | [出版社基础规则及棋盘图](https://www.scorpionmasque.com/sites/scorpionmasque.com/files/st_rules01_en_06jun2023.pdf) | 七轮；全部基础操作、咖啡、重掷、降落检查。其他航线未录入 |
| 2 | The Crew: Mission Deep Sea | 官方 Promo 1，及牌面写明的 3 墩后续挑战，3–5 人 | [官方规则](https://www.thamesandkosmos.co.uk/wp-content/uploads/2021/02/691869_Crew_Deep-Sea_Manual.pdf)、[Kosmos 官方 Promo](https://cms.kosmos.de/Downloads/Die%20Crew/Crew_2_Promo_Cards_DE.pdf) | 此任务只需完整 40 张基础牌；不需要尚未完整取得的 96 张任务卡。**不是基础战役第 1 关** |
| 3 | Bomb Busters | Mission 1，2–5 人 | [官方规则](https://www.cocktailgames.com/wp-content/uploads/2023/10/BombBusters_rules_EN.pdf)中的任务正面、任务背面实物照片及官方 FAQ；细节见专项说明 | 仅 1–6 各四条蓝线；不把后续任务、红黄线和公共设备悄悄简化成这一关 |
| 4 | The Crew: The Quest for Planet Nine | Mission 1–3，3–5 人 | [官方基础规则](https://www.thamesandkosmos.com/manuals/full/691868_Crew_Manual.pdf)、[IELLO 官方日志摘页](https://iello.fr/wp-content/uploads/2020/05/The-Crew_Log-Book.pdf) | 任务数为 1、2、2；第 3 关有顺序符号；不是 50 任务全集 |
| 8 | The Gang | 2024 基础版，3–6 人 | [Kosmos 官方完整规则](https://www.thamesandkosmos.com/manuals/full/683887_TheGang_Manual-Web_051624.pdf) | 标准 52 张扑克牌、四轮筹码、完整三胜/三败终局；无需专家设备牌 |
| 9 | Take Time／时序谜局 | Chapter 1, Clock 1（1-1），2–4 人 | [官方中文规则](https://cdn.svc.asmodee.net/production-libellud/uploads/2025/09/TT_RULES_CNS_WEB.pdf)与既有已审计引擎 | 复用相邻 `take-time` 项目，增加可持久化适配；明置仍为可选，全部暗置合法 |
| 10 | Hanabi | Cocktail Games 2019 五色版，2–5 人 | [该版官方规则](https://www.cocktailgames.com/wp-content/uploads/2016/03/Hanabi_regles_0519_BD.pdf) | 固定 50 张分布；按此版允许空提示；计分终局不造二元阈值 |
| 11 | Magic Maze | **2017 官方 PnP 试玩版**，按完整试玩套件实现 | 出版社署名的 [Print & Play PDF 镜像](https://ludovox.fr/wp-content/uploads/ressources/MM_Print%26Play.pdf)，含完整九张地图和行动卡 | 文件标为制作中试玩版，**不是 2018 零售版全部 17 场景**；版次、地图、计时与规则单独固定 |
| 12 | The Mind | 基础明置模式，2/3/4 人完整 12/10/8 级 | [NSV 官方英文规则](https://www.nsv.de/wp-content/uploads/2024/04/TheMind_GB.pdf) | 100 张数字牌可精确重建；支持专注、暂停、生命、飞镖；不包括胜利后的暗置挑战 |
| 13 | The Game | 原版基础，1–5 人 | [NSV 官方英文规则](https://www.nsv.de/wp-content/uploads/2024/04/TheGame_GB.pdf) | 2–99 共 98 张、四堆、反向十；多智能体研究应选择 2–5 人 |

### 本轮放弃的三款

这里的“没找到”是**此次核查没有取得可验证的完整组件集**，不是宣称互联网上绝对不存在。

| 游戏 | 已读到 | 缺失的开局必需数据 | 为什么不生成一些数据代替 |
|---|---|---|---|
| Just One | [2025 官方英文规则](https://cdn.svc.asmodee.net/production-rprod/storage/games/justone/NEW/jo-en02-rules-mkt-1749635213L3H57.pdf)、[出版商下载页](https://www.rprod.com/en/games/just-one) | 110 张、每张五词的实际牌库；规则示例不足以重建官方随机 13 张抽样或独立完整试玩套件 | 社区自编词库与自动生成词不能冒称该版原始牌面 |
| So Clover! | [官方规则](https://cdn.svc.asmodee.net/production-rprod/storage/downloads/games/so-clover/sc-en01-rules-16197761427wP8d.pdf)、[产品与下载页](https://www.rprod.com/en/games/so-clover) | 220 张四边词卡的分组与方向；少量示意牌不能组成已核实的多人完整套件 | 只有词表也不够：哪四词印在同一张卡上会直接改变重建问题 |
| Codenames: Duet | [当前官方规则](https://filemanager.czechgames.com/storage/files/codenames-duet/rules/codenames-duet-rules-en.pdf)、[2017 版说明](https://www.czechgames.com/games/codenames-duet-2017)、[2025 版说明](https://www.czechgames.com/games/codenames-duet) | 对应版本的词卡与成对双面钥匙全集；未核实可独立开局的完整官方示例套件 | 可以按分布随机造钥匙，但这会形成研究生成的数据集；本轮不把它混进官方范围 |

三款均不在注册表，不返回假环境；创建会明确拒绝。后续若取得原组件或完整官方试玩套件，可直接补适配器。语言提示的合法性/同词族判断是**另一个**问题，并非本轮排除它们的唯一理由。

## 证据和接口如何复用

- 每款 adapter 自带 `metadata.sources`、`scenarios`、`implementation.implemented/omitted/verifier/notes`。
- 规则中的图形数据采用 PDF 渲染核对；来源快照/图示/校验值在 `sources/` 和专项实现文档。
- 按任务和版次分别命名，不能拿 Promo、试玩版、教学关卡代表完整盒装游戏。
- 原版使用普通数值牌或标准扑克牌时，可按规则给定的集合生成相同分布；这和编造词卡、任务条件或地图不同。
- 来源公开、原组件数据可核实、开源许可、数据集公开分发权是不同字段；当前没有把公开 PDF 标成开放许可。服务不对外分发出版商原图。

环境与工具流程见 [runtime-api.md](runtime-api.md)。专项规则说明见 [Sky Team](implemented-sky-team.md)、[两款 The Crew](implemented-crew.md)、[四款数字合作](implemented-card-coops.md)、[Bomb Busters](implemented-bomb-busters.md)、[Magic Maze](implemented-magic-maze.md)。

最终验证：统一项目 111 项测试全部通过；47 个已注册场景与人数组合全部到达规则终局并通过确定性回放，0 执行错误、0 预算截断。详细结果见 `artifacts/test-results.tap` 和 `artifacts/smoke-report.json`。相邻 Take Time 原项目的 50 项既有测试也通过。这里统计的是实现验证，不是 LLM 能力胜率。
