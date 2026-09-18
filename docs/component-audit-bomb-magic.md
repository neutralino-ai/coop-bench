# 补充组件审计：Magic Maze 与 Bomb Busters

核验日期：2026-09-16。判断标准是能否完整开出一个注明版本的真实官方关卡，而不是仅有规则摘要就自行补牌或删机制。

## Magic Maze：保留并实现公开 PnP 试玩关

[出版商署名的完整 PnP](https://ludovox.fr/wp-content/uploads/ressources/MM_Print%26Play.pdf) 有 11 页，包含基础规则、九张完整地图、十九张行动卡和标记。地图与卡面均逐页渲染检查。文档明确是 2017 年发行前试玩版本，地图带 WORK IN PROGRESS 水印；它与零售版颜色、地图和后续规则并不完全相同。

因此不以“零售 24 张地图不全”为理由丢弃整款游戏，而是实现 `pnp-2017-discovery`。数字化全部九图的地形、墙、探索点、物品、传送点、电梯、沙漏与共同出口；没有靠猜测补关卡。完整说明见 [implemented-magic-maze.md](implemented-magic-maze.md)。

## Bomb Busters：保留 Mission 1，后续关卡不因有 PDF 就自动纳入

### 官方公开资料

- [出版商产品与下载页](https://www.cocktailgames.com/jeu/bomb-busters/)
- [英文规则 PDF](https://www.cocktailgames.com/wp-content/uploads/2023/10/BombBusters_rules_EN.pdf)
- [法文规则 PDF](https://www.cocktailgames.com/wp-content/uploads/2023/10/Bombbusters_regles_BD.pdf)
- [官方 FAQ](https://www.cocktailgames.com/nos-jeux/bomb-busters-faq/)
- [高清素材 ZIP](https://www.cocktailgames.com/wp-content/uploads/2023/10/Bombbusters.zip)
- [设备卡展示图](https://www.cocktailgames.com/wp-content/uploads/2023/10/Bombbusters_cartes_equipements-2.jpg)
- [公开追加任务 67](https://www.cocktailgames.com/wp-content/uploads/2023/10/Mission67_cite.pdf)
- [公开追加任务 68–70](https://www.cocktailgames.com/wp-content/uploads/2023/10/Mission686970.pdf)

英文规则第 2 页展示 Mission 1 正面，但同页的背面示例实际是 Mission 5。仅凭这页不能断言 Mission 1 背面没有附加内容。

本轮另一路研究补齐了正式日文任务组件的 [正面高清照片](https://i.gzn.jp/img/2025/07/20/bomb-busters/25.jpg) 与 [背面高清照片](https://i.gzn.jp/img/2025/07/20/bomb-busters/27.jpg)，来自 [Gigazine 对发行方 Engames 供样的评测](https://gigazine.net/news/20250720-bomb-busters/)。这是第三方托管的正式组件实拍，不能标成 publisher-hosted。正面与官方英文规则图交叉核对；背面确认该关的正常双人剪线／单人剪线说明。此关不需要随机设备卡，因此可独立实现。完整出处、实现与限制见 [implemented-bomb-busters.md](implemented-bomb-busters.md) 及 `sources/bomb-busters-source-manifest.json`。

### 仍缺少什么

官方高清 ZIP 中的 `Bombbusters_cartes_equipements_HD.jpg` 已打开检查：是四张叠放展示图，7 号设备重复，两张文字被遮挡；并不是十二张设备的完整平铺。高清文件名不等于完整组件。FAQ 补充部分设备裁定，也不是全部设备原文的替代品。

追加任务 67–70 的任务纸确实完整公开，但它们依赖标准游戏组件和设备规则。不能仅因为任务纸完整就删除其设备机制，做成一个冒称官方的简化局。因此本次只纳入已经补齐的 Mission 1；公开追加任务保留为待补齐组件的来源，而不是伪造、无条件纳入或声称这些任务不存在。

### 可复用的核验经验

1. 核对任务正反面的编号；规则书示例可能故意展示不同任务。
2. 对地图和卡牌查看实际图像；PDF 文本提取会丢失颜色、箭头、牌值、墙和反面说明。
3. “有高清 ZIP”与“有完整牌面”分别判断；展示图可能重叠、重复或遮挡。
4. 公开任务纸与它依赖的基础组件必须一起完整；不要为了实现而删去缺资料的机制。
5. 出版商授权试玩不等于美术开源或训练语料授权；记录托管者、作者和可用范围。
