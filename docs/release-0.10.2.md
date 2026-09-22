# Coop Bench 0.10.2

- macOS Intel 与 Apple Silicon 的管理端、Player 使用 Developer ID 签名及 Apple 公证，包含离线公证票据；继续从 GitHub Releases 下载更新。
- iOS 接入 Apple Distribution 签名及 TestFlight 上传流程，保留同版本 Xcode 工程包。TestFlight 可安装状态取决于 Apple 处理和测试分发配置，工程 ZIP 本身不是可安装 IPA。
- 四平台原有测试与真实打包客户端验收保持；签名材料缺失、公证或 Gatekeeper 校验失败会阻止发布。

Windows 安装包仍未做 Windows 代码签名。未将 CI 验证等同于实体 Mac/iPhone 安装或麦克风验收。本次不改动游戏后端或已有对局。
