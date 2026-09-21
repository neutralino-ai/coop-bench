# iOS 客户端：Xcode 自签安装交付

用户选择通过自己的 Mac / Xcode 安装。首版版本号 0.9.5（build 1），最低 iOS 17；采用 SwiftUI / WKWebView，共享现有大厅、回放和玩家网页，Swift 负责 HTTPS、Keychain、本席运行器及 Responses harness。没有打包服务器或游戏引擎。

## 取得工程

- 已验证源码：分支 `codex/ios-client`，提交 `29f71142409c67904016b872c7ea6ccf2f4e5bf2`。本次没有发布桌面新版本，也没有改动线上服务。
- [成功构建与验收](https://github.com/neutralino-ai/coop-bench/actions/runs/35583007884)。下载其中 `ios-xcode-project` artifact，解压外层归档，再解压 `Coop-Bench-iOS-Xcode.zip`。CI artifact 保留 30 天；源码分支仍可自行构建。
- 工程包 SHA-256：`6e8f69ece5f9f432f4af81b7b74ec77798ab01487f865748f59e0954b0cab62a`。
- 打开 `ios/CoopBench.xcodeproj`，在 CoopBench target 的 Signing & Capabilities 选择自己的 Team，连接 iPhone 后 Run。需要 Xcode 26.3 或更新正式版；完整说明见 [iOS README](../ios/README.md)。工程包已包含网页资源，无需 Node / XcodeGen。
- 从源码构建时先 `git switch codex/ios-client`，再按 iOS README 执行。不要把 main 或其他任务尚未提交的网页修改当成本次验证内容。

## 已实现

密码登录、大厅房间列表、创建房间、房主发放 seat token、人类入席、人齐后开始、回放和三分钟默认时限说明。房主可复制 Claude 玩家提示词、启动内置 Agent、复制席位密钥及开局前踢人。邀请只预填地址和房间，仍需本席密钥。

内置 Agent 使用 Responses API，入席前完成两轮实际工具调用预检；不强制 `tool_choice: required`。保留服务返回的 reasoning / function call 历史，有限重试、请求总期限、空输出和认证错误有明确处理。API key 和登录会话保存在系统 Keychain，玩家网页拿不到房主权限或其他席位密钥。

每席持久保存未确认动作，响应丢失时使用原 Idempotency-Key 和原动作重试。原始消息可分片上传、校验、封存；本地记录不自动删除。返回前台恢复观察和上传；保存模型 key 的 Agent 席位重开后会重新预检再恢复。

## 验收证据

2026-09-21，macOS 26 / Xcode 26.3 / iPhone 17 Pro 模拟器 / iOS 26.2：

- 原生单元测试 3 / 3：真正的模拟器 Keychain 读写、本席存储隔离、权限和地址检查、与 JavaScript 一致的规范 JSON。
- 桥接测试 3 / 3：玩家角色权限、二进制响应、事件取消订阅。
- 模拟器应用验收 36 / 36：密码登录、大厅、回放后继续调用原生桥接、建房、人类入席、复制含本席 token 的 Claude 提示词、人齐后开始、模型预检及故障提示、行动和上传、规则弹窗。五个页面通过手机宽度检查，并人工查看截图。
- 故障注入：服务器接受动作后断开响应，记录到一次完全相同请求的幂等重试；流式请求达到总期限会取消；跨地址重定向被拒绝；错误模型 key 不能入席。
- Swift 生成的分片已交给现有 JavaScript 工具重新组装，内容和 SHA-256 校验通过。
- 未签名真机 Release 编译通过；工程归档 46 项，仅包含明确允许的客户端源文件、网页、测试、Xcode 工程及说明。

模拟器测试使用公开仓库的合成 HTTP / 模型数据，不是游戏引擎验证或真实 DeepSeek 调用。未在用户的实体 iPhone 上签名、安装或完成实局；这些不能从 CI 结果推定。

## 使用限制

游戏及内置 Agent 需保持应用前台。活跃席位会阻止自动锁屏，切到后台后暂停客户端；服务端期限仍继续计时。旧局超时策略遵循该局已保存的服务端设置，不由手机重写。

Personal Team 自签有效期遵循 [Apple 说明](https://developer.apple.com/help/account/basics/about-your-developer-account)，通常需要每七天重新安装。此交付是 Xcode 工程，不是已签名 IPA、App Store 或 TestFlight 发布。

本地交付副本与验收证据位于被忽略的 `artifacts/ios-delivery/`、`artifacts/ios-verified/`。另一个任务正在修改玩家历史、提示知识和审计 UI，这些未提交修改没有混入本次已验证工程包；后续合入后需重新构建。
