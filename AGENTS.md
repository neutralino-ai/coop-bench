# Coop Bench 公开客户端接手指南

**2026-09-21 / 0.10.0 已正式发布**：账号归属、房主 token、人类原席恢复、Agent 状态/恢复与配套服务已上线；main/tag 版本提交 `848653a`。正式四平台及发布 CI `35602174531` 全成功，12个附件含同版iOS工程。0.9.7更新器实际发现新版、Windows完整下载校验通过，iOS工程也已下载校验；不等于实体iPhone安装验证。详见 [交付记录](docs/desktop-0.10.0-delivery-2026-09-21.md)。

**发布要求（2026-09-21）**：用户要求今后每次发布同步带上 iOS。统一版本号；桌面三平台与 iOS 原生/模拟器验收全部通过后发布，Release 必须附同版本 Xcode 工程包。iOS 当前沿用用户选择的 Mac / Xcode 自签安装，不得把工程包宣称为已签名 IPA 或真机安装验证。

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
