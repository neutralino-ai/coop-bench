# Coop Bench 0.10.2

- macOS Intel 与 Apple Silicon 的管理端、Player 使用 Developer ID 签名及 Apple 公证，包含离线公证票据；继续从 GitHub Releases 下载更新。
- iOS `0.10.2 (17.1)` 已完成 Apple Distribution 签名、上传及 Apple 处理，可供已获邀的内部测试者通过 TestFlight 安装更新；保留同版本 Xcode 工程包。尚未公开上架 App Store，工程 ZIP 本身不是可安装 IPA。
- 四平台原有测试与真实打包客户端验收保持；签名材料缺失、公证或 Gatekeeper 校验失败会阻止发布。

Windows 安装包仍未做 Windows 代码签名。未将 CI 验证等同于实体 Mac/iPhone 安装或麦克风验收。本次不改动游戏后端或已有对局。

构建与验收：[四平台及 TestFlight CI](https://github.com/neutralino-ai/coop-bench/actions/runs/35683963977)，版本提交 `2be7407685362f1bafc8822576e53d101959e79f`。
