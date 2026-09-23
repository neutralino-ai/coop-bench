# 客户端架构与边界

- web/：桌面和 iOS 共享静态界面。index.html 以 classic script 加载；lint 从该入口的真实顶层声明解析共享符号，未定义名称仍报错。
- desktop/：Electron 主进程、受限 IPC、系统凭据与更新器。renderer 不获得人工密码或模型 key。
- client/：本席 HTTP 协议、消息分页、Agent 会话与恢复；modelObservation 去除行动令牌，凭证不得传入模型上下文。
- ios/：SwiftUI/WKWebView、Keychain、原生运行器；不能依赖 Node/Electron。
- scripts/、build/：构建、签名、制品白名单、公开下载验证。公开安装包不得包含服务端规则或私有实验资料。
- test/、desktop/*smoke*：协议与合成 UI 验证；模拟 API 的结果不等于真实游戏规则或实体 iPhone 结果。

服务端是规则/合法性/信息可见性/计分/期限的唯一权威。接口变更先定义兼容契约，在各自仓库同步验收，公开仓库只保存公开协议和合成 fixture。
