# Coop Bench iPhone / iPad 客户端

原生 SwiftUI + WKWebView 应用，最低 iOS 17。复用仓库中的大厅、回放与玩家界面；网络、钥匙串、席位运行器和 Responses Agent 由 Swift 实现。只连接远程 API，不包含游戏引擎。

## 用自己的 Mac / Xcode 安装

也可从 [统一客户端构建记录](https://github.com/neutralino-ai/coop-bench/actions/workflows/desktop-build.yml) 中成功的运行下载 `ios-xcode-project`，解压其中 `Coop-Bench-<版本号>-iOS-Xcode.zip`，直接打开 `ios/CoopBench.xcodeproj`，然后从下面第 4 步继续。正式发布时，此压缩包与桌面安装包一起附在同一个 Release 中，包含已准备好的网页资源，首次安装无需 Node 或 XcodeGen。

1. 在 Mac 安装 Xcode 26.3 或更新正式版（含 iOS 平台组件），打开一次完成初始化；在 Xcode → Settings → Accounts 登录自己的 Apple ID。
2. 安装 Node.js 24 或更新版本，以及 [XcodeGen](https://github.com/yonaskolb/XcodeGen)。使用 Homebrew 时执行 `brew install node xcodegen`。
3. 克隆公开仓库后，在仓库根目录运行：

   ```sh
   node scripts/build-ios.mjs
   xcodegen generate --spec ios/project.yml
   open ios/CoopBench.xcodeproj
   ```

   iOS 构建无需安装 Electron 或 npm 依赖。每次更新代码后重新执行前两条命令。

4. 在 Xcode 选中 CoopBench target → Signing & Capabilities，勾选 Automatically manage signing，选择自己的 Team。若默认 Bundle Identifier 无法签名，换成自己的唯一标识，例如 `com.yourname.coopbench`。
5. 连接 iPhone，在手机上信任 Mac，并根据 Xcode 的提示开启“设置 → 隐私与安全性 → 开发者模式”。选择该手机作为运行目标，点击 ▶ Run。
6. 打开后使用 Coop Bench 用户名和密码登录。新用户先用一次性注册 token 创建账号。默认服务器为 `https://coop.neutrinophysics.cn:34936/api/v1`；可在“账号与服务器设置”修改。0.10.0 需要支持账号归属的新后端。

个人 Apple ID 可用于个人设备开发测试；Personal Team 的签名通常 7 天到期，需要重新构建安装，见 [Apple 说明](https://developer.apple.com/help/account/basics/about-your-developer-account)。此流程不需要 TestFlight；CI 构建不包含你的签名，不能把模拟器产物直接装到手机。

## 使用与边界

- 登录后显示“我创建的”“我参与的”、可加入房间和对局回放。创建者自动成为房主；房主管理凭证由原生客户端自动获取，顶部可创建房间。
- 房主发放 seat token；人类、外部 Agent 和内置 Agent 使用相同席位权限。邀请链接只预填房间信息，仍需本席密钥。
- 内置 Agent 加入前须通过两轮 Responses 工具调用测试。模型 key 按服务器和账号隔离，保存在本机钥匙串，不交给玩家网页；默认 DeepSeek。
- 人类“返回大厅”保留席位，可从“我参与的”恢复；换设备以同一账号登录也可恢复。开局前可明确释放席位。断网后动作使用原 Idempotency-Key 重试；原始记录保留在手机并重试上传。
- 选择保存模型 key 时，也会保存本账号的内置 Agent 席位配置。重新登录后验证模型连接并恢复；没有选择保存时，退出进程后不会保留模型凭证。每个席位只在一个客户端运行。
- 参赛时保持应用前台。iOS 后台会暂停客户端运行，服务器的三分钟倒计时继续；超时策略由该对局服务端决定。回到前台重新读取本席观察。
- 所有合法动作、规则和信息可见性均由服务端决定。玩家页面只能访问本席，不持有房主登录凭证或其他玩家的密钥。

## 验证

`.github/workflows/ios-build.yml` 在 macOS 编译、运行原生单元测试、在 iPhone 模拟器连接合成 HTTP / 模型夹具，并编译未签名的真机 Release。合成测试不是完整游戏引擎或真实模型测试，模拟器结果不能替代实际 iPhone 安装验收。

工程由 `project.yml` 生成；`Web/`、`.xcodeproj`、DerivedData 和签名产物不提交。修改共享网页后执行 `node scripts/build-ios.mjs`。
