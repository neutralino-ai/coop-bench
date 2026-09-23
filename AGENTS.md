# Coop Bench 公开客户端接手指南

**2026-09-23 / 0.11.13 已正式发布**：iPhone Player 按席号排手牌，删除人类理由/语音；最近队友动作和完整历史默认展开；终局真实 Agent 轨迹改为紧凑六色块，移除重复的实际模型请求窗口，管理员窄屏清单优化。代码已快进合并公开 `main`，标签提交 `20dc7d1`；四平台签名、公证、TestFlight/Release CI `35825172671` 全成功，12 附件及旧更新器公开下载验收 `35827096582` 通过。iOS `0.11.13 (38.1)` 为 VALID / IN_BETA_TESTING，实体设备未验收。配套 34936 服务端 build `a4447b872d0c` 已获单独授权并空闲上线，旧 34935 保持。见 [交付记录](docs/release-0.11.13-delivery-2026-09-23.md)。

**2026-09-23 / 0.11.12 已正式发布**：Windows旧版发现更新后下载报笼统“网络或磁盘问题”。原异常被旧更新器覆盖，无法追认最初原因；本机磁盘/目录可写、GitHub安装包和SHA-256均核实。新版对临时下载断线及429/5xx自动重试，超时延至30分钟，并区分超时、空间、权限错误。tag `c08e6e4`；126单元、各桌面管理端131/Player25、iOS模拟器76通过；四平台签名/公证/TestFlight/Release CI `35802167511` 全成功，12附件及旧更新器公开下载验收 `35803777999` 通过。TestFlight `0.11.12（34.1）` 已 VALID / IN_BETA_TESTING；同版Windows安装包已下载到本机真实更新目录并校验，未自动安装或中断对局。见 [交付记录](docs/release-0.11.12-delivery-2026-09-23.md)。

**2026-09-22 / 0.11.11 已正式发布**：移除“Agent直接开局（高级）”，创建统一走房间；清理直接发牌、批量席位配置、旧样式/测试和无用状态，桌面/iOS桥接禁止直接创建对局。版本/tag `651c917`，124单元、各桌面管理端131/Player25、iOS模拟器76通过；四平台签名/公证/TestFlight/发布CI `35720412577` 全成功，12公开附件及旧更新器真实下载验收 `35722431356` 通过。TestFlight `0.11.11（33.1）` 已 VALID / IN_BETA_TESTING，实体设备未验收。工作树 `client/artifacts/ios-game-entry` / `codex/ios-game-entry-fix`；未改动服务端实验API、部署或真实对局。见 [交付记录](docs/release-0.11.11-delivery-2026-09-22.md)。

**2026-09-22 / 0.11.10 已正式发布**：Coding Agent通用提示词与自取署名、人类使用登录用户名、手机蓝色回合提示和紧凑牌桌、语音取消/恢复及时刷新、进行中回放默认直播跟随；另修复游戏目录未就绪时创建无响应。版本/tag `00353ba`，工作树 `client/artifacts/ios-game-entry` / `codex/ios-game-entry-fix`。124单元、各桌面管理端133/Player25、iOS模拟器75通过；四平台签名/公证/TestFlight/发布CI `35717494086` 全成功。12公开附件及旧更新器真实下载校验 `35719217813` 通过。TestFlight `0.11.10（32.1）` 已 VALID / IN_BETA_TESTING；真机麦克风与安装体验未验收。未部署后端或中断对局。见 [交付记录](docs/release-0.11.10-delivery-2026-09-22.md)。

**2026-09-22 / 0.11.8 已正式发布**：统一牌局/轨迹/观测/附件读取额度，去掉重复刷新，限流不误报断线；修复慢登录响应覆盖用户回放导航。tag `2e3f888`，118单元、各桌面管理端126/Player25、iOS模拟器68通过。CI `35705482603` 四平台及TestFlight上传通过，Apple Silicon一次测试竞态重跑；发布阶段因说明文件缺失后单独补发原包，12附件SHA-256全匹配，不称整条CI全绿。TestFlight `0.11.8（30.1）` 已 VALID / IN_BETA_TESTING。没有后端部署或中断对局，实体设备未验收。详见 [交付记录](docs/release-0.11.8-delivery-2026-09-22.md)。

**2026-09-22 / 0.11.5 已正式发布**：手机开局HTTP400修复、实时回放行动者和倒计时、菜单绿灯强制检查、单行拖动时间条、五色紧凑轨迹卡和本轮tool use高亮。版本/tag `3eb50a0`，四平台签名/公证/TestFlight/发布CI `35698630310` 全通过；110单元、管理端126/Player25、iOS模拟器68，12公开附件和旧更新器实际下载校验通过。TestFlight `0.11.5（27.1）` 已 VALID / IN_BETA_TESTING，真机未验收。详见 [交付记录](docs/release-0.11.5-delivery-2026-09-22.md)。

**2026-09-22 / 0.11.1 已正式发布**：创建新房间及房间成员弹窗统一白底，标题与内容不再出现两层背景。版本/tag `a96c60a`，分支 `codex/room-background`，工作树 `client/artifacts/member-login`。四平台、Mac签名公证及TestFlight发布CI `35692621925` 全通过；管理端120/Player25、iOS模拟器59项，12个公开附件和0.11.0更新器真实下载校验通过。iOS `0.11.1 (22.1)` 已 VALID / IN_BETA_TESTING。未操作服务端或对局，实体设备未验收。详见 [交付记录](docs/room-background-delivery-2026-09-22.md)。


**2026-09-22 / 0.11.0 已正式发布**：operator/member 两种角色、管理员用户/邀请码/批量对局操作、member 登录修复及任意对局回放导出，移除客户端审阅批注。删除账号保留历史署名，删除对局只允许终局。版本/tag `e9d4bd7`，四平台签名 CI `35690859160` 全成功；每平台管理端120/Player25、iOS模拟器58项通过，12个公开附件与0.10.3更新器真实下载校验通过。iOS `0.11.0 (20.1)` 为 VALID / IN_BETA_TESTING，实体设备未验收。详见 [交付记录](docs/operator-member-delivery-2026-09-22.md)。


**2026-09-22 / 0.10.3 已正式发布**：“可加入的房间”移除重复的“返回我的对局”和“管理房间”，继续从“我参与的”“我创建的”进入对应功能。版本/tag 提交 `2e1d19c`；四平台、macOS 签名公证、iOS TestFlight 上传及发布 CI `35687709879` 全成功。公开 Release 12 个附件，0.10.2 更新器已实际发现新版并完成 Windows/iOS 下载校验。iOS `0.10.3 (19.1)` 已上传 TestFlight；Apple 后续处理状态和实体设备安装另行确认。详见 [交付记录](docs/desktop-0.10.3-delivery-2026-09-22.md)。

**2026-09-22 / 0.10.2 已签名发布**：macOS Intel/Apple Silicon 的管理端和 Player 均为 Developer ID 签名、公证并附票据，最终 ZIP/DMG Gatekeeper 全通过。版本提交 `2be7407`，四平台及 TestFlight 上传 CI `35683963977` 成功；GitHub 12 个附件与旧版更新器下载校验通过。iOS `0.10.2 (17.1)` 已经 Apple 处理，内部 TestFlight 可测，仅持有人获邀；后续安装/更新优先 TestFlight，无需自己的 Mac。真机安装与麦克风仍待用户验收。详见 [交付记录](docs/apple-signing-delivery-2026-09-22.md)。

**2026-09-22 / 0.10.1 已正式发布**：“我创建的”仅未结束房间且管理按钮在右；审查统一进回放，进行中回放、彩色完整录制轨迹、中文 Agent 理由、人类可选理由及 iOS 语音草稿已实现。发布提交 `895201e`，四平台及发布 CI `35675320034` 全通过；0.10.0 更新器已实际发现/下载校验，12 个附件含 iOS 同版工程。详见 [交付记录](docs/desktop-0.10.1-delivery-2026-09-22.md)。真机麦克风未验收。

**2026-09-21 / 0.10.0 已正式发布**：账号归属、房主 token、人类原席恢复、Agent 状态/恢复与配套服务已上线；main/tag 版本提交 `848653a`。正式四平台及发布 CI `35602174531` 全成功，12个附件含同版iOS工程。0.9.7更新器实际发现新版、Windows完整下载校验通过，iOS工程也已下载校验；不等于实体iPhone安装验证。详见 [交付记录](docs/desktop-0.10.0-delivery-2026-09-21.md)。

**发布要求（2026-09-22 更新）**：每次发布同步 iOS、统一版本号；桌面三平台与 iOS 原生/模拟器验收全部通过后发布，Release 必须附同版本 Xcode 工程包。macOS 必须签名、公证并通过最终包 Gatekeeper 验证；iOS 签名导出并上传 TestFlight。Apple 上传成功、处理完成、测试者可用与真机验收是不同证据；工程 ZIP 不等于 IPA。签名材料只放仓库 Actions Secrets，公开下载无需嵌入下载密钥。

**2026-09-21 / 0.9.6 已发布**：人类页面点牌操作、历史与提示知识、输入审计 UI、圆点计数和通知自动消失。三平台 CI 与公开 Release 成功，旧版更新器识别及 Windows 下载校验通过；配套审计后端因活动对局尚未切换。见 [交付记录](docs/desktop-0.9.6-delivery-2026-09-21.md)。
**iOS（2026-09-21）**：用户选择自己的 Mac / Xcode 安装。`ios/` 为 SwiftUI / WKWebView 原生客户端，共享网页；源码分支 `codex/ios-client`。Xcode 26.3 原生测试、36 项 iPhone 模拟器流程及未签名真机 Release 编译已通过；实际 iPhone 安装仍未验证。工程下载、准确提交和验证边界见 `docs/ios-client-2026-09-21.md`，安装步骤见 `ios/README.md`。运行器及 Keychain 在 Swift 内，不能直接移入 Node/Electron 模块；玩家原生桥接只允许本席操作。

**2026-09-21 新要求**：新房间默认行动时限 180 秒；新对局超时执行服务端确定性合法默认动作并继续。旧局保留已存期限和策略。客户端 0.9.5 同步倒计时及内置/外部 Agent 提示；交付状态见 docs/release-0.9.5.md。

**0.9.4**：内置 Agent 默认 DeepSeek Responses，入席前两轮工具验证、系统加密保存 API key；有限重试/超时后明确停止。保留 reasoning/tool 历史，房主页开局后刷新模型错误。测试与边界见 docs/release-0.9.4.md，发布状态需查 GitHub CI/Release。

**0.9.3**：房主页逐席提供 Claude 提示词 / 内置 Agent / seat token / 踢出；roomId + 房主 seat token 可直连，玩家指南为 /player.md。发布验收见 docs/release-0.9.3.md。

**2026-09-21 / 0.9.2**：密码登录首屏、双区块大厅、房主发放 seat token、人类自动准备与进行中回放。运行器按服务器截止时间计算预算，支持新服务默认600秒。发布状态及测试见 docs/release-0.9.2.md 和 docs/lobby-client-2026-09-21.md。已有继承的修改须保留，不要 reset/clean。

## 仓库边界

这个仓库是 neutralino-ai/coop-bench 的全新客户端历史（0.9.1 起）。后端和旧完整 Git 历史已迁到维护者的独立私有仓库。**不得把旧仓库的历史、src/、游戏引擎、服务器、数据库、部署材料或含后端的旧安装包合并/上传回来。** 私有部署、服务器修复在私有工程进行。

本地可能同时存在旧完整 checkout 与本仓库；先检查 cwd、git remote 和 git status。不要把旧仓库的 tags 推到这里。这个公开仓库不需要服务器 SSH、云密钥、owner 真实密码或数据库访问权限。

## 项目目标

合作型非 RPG 桌游用于多智能体评估及后续 RLVR/SFT。管理端给人审计，Player/运行器给玩家；规则验证、官方可见性、合法沟通阶段、计分和期限由远程服务统一控制。

用户要求回放一屏看到：各玩家手牌、本席可见信息、实际决策记录、动作。主要文字保持可读，不让各种内部 ID 淹没信息。模型 messages 必须来自比赛中真实记录；模型 API 实际返回的 reasoning、摘要、加密字段和不可获得的内部思考分开标注，不能补造。

作为参赛 Agent 时只读 PLAY.md，使用自己的席位配置。开发/审计权限不交给玩家。多个 Agent 独立上下文和凭证目录；同机目录隔离不是操作系统级防作弊边界。

## 代码地图

- web/: 本地静态管理和 Player 界面。
- desktop/: Electron 主进程、受限 IPC、系统加密会话、更新客户端。
- client/: 邀请协议、模型/外部 Agent 运行器、HTTP 席位客户端、MCP 工具包装。
- scripts/: 仅客户端构建、参赛及原始日志上传。
- build/: 两个安装包的显式文件白名单。
- test/、desktop/*smoke*: 客户端测试及模拟 API。不能放真实游戏核。

服务地址：34935 旧实验，34936 新实验，域名 coop.neutrinophysics.cn；0.9.2 新安装默认地址为 34936；已有保存地址不自动迁移。不能更换已有对局的端口。远程 MCP HTTP 路由尚未交付，已有 MCP 是本地 stdio 桥接；不要把规划写成已上线。

## Mac / Windows 验收

Node 24.21+、pnpm 11.19.0；使用锁文件。先 pnpm test，再 pnpm build，构建当前平台管理端与 Player，并运行 desktop/ci-client-smoke.mjs 与 desktop/ci-player-smoke.mjs 对真实打包应用做模拟 API 验收。CI 三平台均成功后才发 Release。记录版本、CPU 架构、packaged 与检查结果；不要称模拟 API 检查为游戏引擎测试。

实际 Mac 仍需验证 DMG 安装、Gatekeeper、钥匙串、重开、登录/登出、连接灯、回放和附件。不得关闭系统 Gatekeeper 或 TLS 验证。合成测试数据使用独立 artifacts/ 目录，不动用户已存会话。

更新器固定访问公开 neutralino-ai/coop-bench Releases，不能携带游戏凭证。保持应用 ID 和用户数据兼容。所有发布包必须检查无服务器 bundle、部署文件或真实轨迹。

## 凭据与记录

真实配置、邀请、seat token、模型 API key、轨迹、数据库均不提交；.gitignore 不能替代 staged 检查。Electron 保持 contextIsolation、sandbox、CSP、HTTPS 验证及受限 IPC。日志上传内容可能包含私人数据，按用户授权操作并剔除凭据。
