# 普通账号登录后被界面拒绝

0.10.2 的共享页面 `markIdentityVerified` 只接受 coordinator/operator/auditor，遗漏了注册接口返回的 member。注册或密码登录实际上成功，原生层也接受 member，但随后页面读取 `/identity` 时抛错；账号错误处理将未分类异常显示为“账号操作未完成，请检查连接状态后重试”。iOS 和使用同一页面的桌面客户端均受影响。

修复：在身份白名单中加入 member，保留未知角色拒绝；无效身份响应使用 INVALID_API_RESPONSE 分类。没有提升账户权限、修改服务器角色或改动密码。

回归：新增 member 注册、密码登录、连接复查和未知角色拒绝测试。旧代码下 member 测试复现失败，修改后通过。iOS 模拟接口现在返回 member，原生验收增加普通账号注册进入大厅及退出后密码重新登录检查；此前模拟接口始终返回 operator，导致漏检。

本地验证：103 项客户端测试全部通过；`pnpm build`、`pnpm build:ios` 及 `git diff --check` 通过。Windows 沙箱下 esbuild 无法读取父目录，使用正常本地权限重试后构建成功。

交付边界：分支 codex/member-login，独立工作树 artifacts/member-login。尚未运行新版 macOS/iOS CI、原生包内验收或发布；iPhone 上的 0.10.2 不会因本地源码变化自动修复。后续需统一版本完成四平台验收、Apple 签名及 TestFlight 上传，遵守 AGENTS.md 的发布要求。没有重启后端或修改任何真实账号。
