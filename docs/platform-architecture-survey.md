# 在线桌游与开源模拟器：架构调研

核查日期：2026-09-16。仅依据平台官方文档、维护者源码和许可文件。此文档是选型依据，不代表已接入这些平台，也不代表其包含本项目选中的十款游戏。

## 1. 先区分三类产品

| 平台 | 类型与规则执行 | 状态/交互模型 | 对 coop-bench 的价值 |
|---|---|---|---|
| Board Game Arena（BGA） | 在线桌游服务，各游戏实现规则 | 服务端状态机、数据库事务、按玩家下发数据 | 参考权威裁判、短生命周期请求、可见性和状态机 |
| boardgame.io | 开源 JS/TS 回合制框架；需要编写每款游戏规则 | `G` + `ctx`、moves、phases、playerView、可替换存储 | 最贴近现有 TS 技术栈；可选 UI/多人联机适配，不必成为训练内核 |
| Tabletop Simulator（TTS） | 商业三维桌面沙盒；规则自动化取决于模组脚本 | 物体、物理、Lua、存档、联机 | 可辅助人工理解组件和流程，不能把模组存在视为完整裁判存在 |
| VASSAL | 开源桌游桌面工具；官方设计指南通常不建议强制规则 | 模组、棋子操作、联机与邮件对局 | 能参考通用组件，但并非现成 RLVR 验证器 |
| OpenSpiel | 开源博弈与学习环境库；已实现游戏具有可执行规则 | Game/State、chance、legal actions、player observations、clone/serialize | 借鉴环境内核、搜索、复现和信息集的语义 |
| PettingZoo | 开源多智能体 RL 接口与环境集合 | AEC 顺序行动、Parallel 同时行动 | 作为训练接入层与一致性测试规范 |

表内分类依据见下面各平台第一方来源。平台代码许可与具体游戏牌面、美术、规则文本及模组许可是不同事项。

## 2. Board Game Arena：计算实例不保存状态，也能运行有状态桌游

### 核查到的实现

BGA 的服务器使用 PHP 游戏逻辑。官方文档明确：两次回调之间不会保留游戏类实例，每次请求会重新创建对象；局面写入数据库。请求正常结束时事务提交，规则异常可让本次修改回滚。`getAllDatas` 按请求玩家读取视图，通知支持公开内容和按玩家发送的私有内容。[Game.php 官方文档](https://en.doc.boardgamearena.com/Main_game_logic:_Game.php)

阶段模型区分单玩家行动、多玩家行动、玩家各自的私有子阶段和自动执行阶段。旧 `states.inc.php` 文档已标注弃用，新的实现应看 State classes；值得借鉴的是这些语义，而不是照搬旧文件结构。[状态机文档](https://en.doc.boardgamearena.com/Your_game_state_machine:_states.inc.php)

### 对本项目的结论

- **无状态计算实例与有状态应用可以共存。** 短生命周期服务读取数据库、执行一次动作、提交事务，就能横向扩展；无须把全量状态发给玩家。
- 请求者身份与当前行动者是两个概念；观察按请求者投影，权限再检查请求者此刻能否执行该动作。
- 自动阶段应由引擎推进，不能要求 agent 额外调用“发牌”“结算”之类本来不属于玩家决策的操作。
- 没有在本次核查中找到供任意批量 RL 训练使用的公共 BGA 接口承诺；不将生产网站作为训练基础设施假设。

BGA 声明其商业桌游适配已取得对应授权。其开发者条款允许作者在条件下另行发布自己的代码，但不因此开放平台预存代码或游戏素材；具体开源实现仍须逐仓库核对。[游戏许可说明](https://en.doc.boardgamearena.com/BGA_Game_licences)、[开发者条款](https://en.boardgamearena.com/legal?section=legal)

## 3. boardgame.io：很好的参考框架，安全边界仍需自己验证

### 核查到的实现

这是 MIT 许可的 JS 回合制框架，提供状态、联机、匹配、日志和扩展机制；每款游戏的规则函数仍由开发者编写。[官方仓库](https://github.com/boardgameio/boardgame.io)

- `G` 保存游戏数据；`ctx` 保存框架上下文；moves 描述转移。
- phases 可改变动作集合与行动顺序，turn 在 phase 内部运行；服务器计算权威状态。涉及秘密的动作可以禁止在客户端预测执行。[阶段文档](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/phases.md)、[秘密状态文档](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/secret-state.md)
- `playerView` 在发送给玩家前剔除不应知道的 `G` 字段。只在界面隐藏卡牌不够。
- 存储是可替换接口；官方文档列出文件存储和第三方后端适配器，但适配器存在不等于已验证所有并发与持久化要求。[存储文档](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/storage.md)

### 必须借鉴的隐私与一致性检查

对 `main` 分支于 2026-09-16 的源码阅读表明：网络投影会清空 undo/redo，单独处理动作日志，差量更新先分别过滤前后状态再生成 patch。日志只有显式标记 `redact` 才隐藏其他人的动作参数。这说明“当前状态过滤正确”不足以保证整条协议安全。[网络过滤源码](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/src/master/filter-player-view.ts)

采用前至少验证：

1. 初次同步、断线重连、历史日志、差量 patch、插件状态、错误响应是否全部遵守同一信息边界。
2. 私下选牌动作参数是否标记并过滤，不能从日志还原隐藏卡牌。
3. 抽牌、掷骰和揭示后的 undo 是否会带来免费试探。框架明确提供禁止特定动作撤销的选项；评测默认不向玩家开放回滚。[undo 文档](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/undo.md)
4. 原生聊天室是否绕过游戏禁言规则。源码中的聊天广播是单独路径；本项目讨论与提示应进入规则动作接口。[Master 源码](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/src/master/master.ts)
5. 所选数据库适配器和部署拓扑是否能原子保证版本、动作、日志和幂等响应；不能把单进程队列等同于跨实例事务。

额外审计线索：上述 `main` 源码的同步路径中，`Master.onSync` 读取 `initialState`，过滤器通过展开 `syncInfo` 后仅覆盖部分字段返回。**本次未安装运行并端到端复现，不能定性为已确认漏洞**；若采用该版本，必须测试最初发牌等秘密是否经 `initialState` 暴露，并固定实际使用的提交 SHA。此线索不是选择架构的主要论据。

### 选型判断

可借鉴其开发体验，或将其作为可替换网页适配层。研究内核应保持独立，避免引入浏览器预测、匹配系统或聊天语义成为训练规则的一部分。直接采用前做小范围验证，尤其是秘密状态同步、恢复与事务。

## 4. Tabletop Simulator：可交互物理桌面不等于自动裁判

官方产品介绍定位为可以创建、导入并自由操作物体的桌面沙盒；它并不保证每个 Workshop 模组均完整执行官方规则。[产品介绍](https://www.tabletopsimulator.com/)

Lua 脚本可响应玩家和物体事件。`onSave` 返回字符串状态，`onLoad` 恢复；文档建议用 JSON 保存表，物体引用保存 GUID，加载后再查回对象。脚本、物体和自定义 UI 的状态必须显式处理保存/恢复。[事件 API](https://api.tabletopsimulator.com/events/)、[UI API](https://api.tabletopsimulator.com/ui/)

**本项目使用建议：** 可用于人工规则核对和交互原型。若接模组，需要逐项确认合法动作、信息权限、随机性、终局裁判、无界面批量运行能力；未验证前不作为 RLVR 的奖励来源。不要将物理坐标、拖拽操作或渲染帧率强制带入高层决策基准。商业客户端、模组脚本和素材分别核对使用条件。

## 5. VASSAL：开源，但默认依赖玩家遵守桌游规则

VASSAL 是支持在线和邮件方式对局的开源 Java 桌游引擎。其根许可文件是 LGPL 2.1；不意味着任意模组的美术与内容也采用此许可。[官方仓库](https://github.com/vassalengine/vassal)、[许可文件](https://raw.githubusercontent.com/vassalengine/vassal/master/LICENSE)

官方设计指南明确建议通常把规则执行留给玩家，模组工具也未必足以实现全部规则。[官方设计指南](https://vassalengine.org/doc/3.7.5/designerguide/designerguide.pdf)

**本项目使用建议：** 借鉴组件、地图和重放的表达方式；不能因游戏已有 VASSAL 模组，就把它列为“已有完整可训练环境”。要么补全独立规则验证器，要么只用它作人工核对工具。

## 6. OpenSpiel：训练内核的语义参考

OpenSpiel 将配置与状态分开，用 Game 创建 State；状态 API 支持单动作、联合动作、机会节点、合法动作、各玩家观察、收益、深复制和序列化。当前接口还区分带合法性校验的应用方法，因此对外服务必须明确由谁拒绝非法动作。[核心 API](https://openspiel.readthedocs.io/en/latest/api_reference.html)

`observation` 与 `information_state` 分别表达当前可见局面和信息状态；二者不能用服务器全知状态代替。项目包含 Hanabi 等合作环境，但不因此覆盖本次排名靠前的十款商业桌游。[观察 API](https://openspiel.readthedocs.io/en/stable/api_reference/state_observation_string.html)、[信息状态 API](https://openspiel.readthedocs.io/en/latest/api_reference/state_information_state_string.html)、[官方游戏列表](https://github.com/google-deepmind/open_spiel/blob/master/docs/games.md)

**本项目借鉴：** 把运行时、渲染、HTTP 与规则内核分离；显式表示 chance/decision/simultaneous/terminal；支持授权的 clone/serialize/replay；按玩家保存可见历史。克隆全知状态可供可信训练器和裁判使用，不能自动向被评测 agent 开放，否则会允许观察未来抽牌或枚举隐藏牌。

OpenSpiel 根代码采用 Apache 2.0；依赖库与游戏内容仍分别检查。[许可文件](https://raw.githubusercontent.com/google-deepmind/open_spiel/master/LICENSE)

## 7. PettingZoo：统一训练接口，不承诺替你写游戏规则

AEC API 逐个调用可行动 agent，适合轮流或动态行动顺序；Parallel API 收集同时行动，按一轮返回结果。两种接口的转换有语义条件，不能把任何顺序游戏机械改成批量同时动作。[AEC 文档](https://pettingzoo.farama.org/main/api/aec/)、[Parallel 文档](https://pettingzoo.farama.org/api/parallel/)

训练适配器应保留 observation、reward、termination、truncation 和 info 的区别，且每个玩家都能拿到自己的终局结算。接口测试与种子测试可验证环境契约、动作/观察空间和复现行为。[官方环境测试](https://pettingzoo.farama.org/main/content/environment_tests/)

**本项目借鉴：** 先做稳定的 TS 游戏内核和本地批量运行器，再提供 Python AEC 包装；对真正同时行动的游戏提供 Parallel 包装。玩家动作请求的 HTTP 并发能力与游戏规则中的同时行动是不同层次。通信文本需自定义动作/观察编码，不应强制所有动作变成固定小整数。

PettingZoo 采用 MIT 许可；仓库当前明确官方维护 Linux/macOS，Windows 不属于正式支持范围。因此实际训练部署优先在 Linux 环境验证，不能只因本机 Windows 能运行 TS 环境就假设 Python 全部训练依赖也已可用。[官方仓库与版本约定](https://github.com/Farama-Foundation/PettingZoo)、[许可文件](https://raw.githubusercontent.com/Farama-Foundation/PettingZoo/master/LICENSE)

## 8. 落到 coop-bench 的设计决策

以下为综合以上实现经验后的设计判断，而非某个平台的性能保证：

1. **规则内核独立。** 同一内核可由本地训练器、HTTP 服务、人类 UI 调用；游戏模块不直接连接数据库或调用模型。
2. **对局是事务边界。** 同一局动作串行确定结果，多局并行；按 episode 分片，不在同一局内拆出相互竞争的权威状态。
3. **服务计算可无状态。** 使用外部数据库恢复局面，或用一局一个有持久存储的 actor；不要求永久常驻进程。
4. **观察是单独产品。** 每次构造玩家可见视图；规则状态、事件、同步、错误、日志和训练导出都经过明确的权限路径。
5. **同时行动需要规则屏障。** 接收各玩家的秘密选择，收齐后原子结算；不能按网络到达次序提前暴露其结果。
6. **规则聊天与平台聊天分开。** 训练时只有规则动作产生可进入 agent 上下文的交流；禁止普通聊天室绕过禁言阶段。
7. **撤销与分支只给授权研究流程。** 分支保留来源和用途；它不是评测玩家的免费探查工具。
8. **不要重复造已有合格规则引擎。** 先做规则覆盖、许可、信息隔离、可复现四项检查；合格引擎通过适配器接入，不合格桌面模组只作参考。
9. **运行性能与在线持久化分层。** 本地批量 rollouts 可以在受信 worker 内存执行并批量提交完整轨迹；正式在线评测用每步提交的权威服务。两者共享规则语义，但可靠性和故障恢复配置必须明确。

配套机制与 API 决策见 [有状态 API 与 RLVR/SFT 接口设计](stateful-api-design.md)。
