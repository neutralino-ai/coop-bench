# 0.10.2 Apple 签名与分发交付

2026-09-22 北京时间 11:58:44，[0.10.2](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.10.2) 正式公开发布。版本/tag 提交为 `2be7407685362f1bafc8822576e53d101959e79f`；main 已快进到该实现，后续文档提交不改变已发布二进制。客户端仓库继续公开，桌面更新器直接访问 GitHub，不使用下载密钥。

## 构建及签名证据

[CI 35683963977](https://github.com/neutralino-ai/coop-bench/actions/runs/35683963977) 是本次发布的唯一构建来源，启用 `apple_signing`，Windows、macOS Intel、macOS Apple Silicon、iOS 和 TestFlight 上传均成功。发布复用该运行产物；创建标签触发的重复构建 `35685123241` 已主动取消，不能将其误认为发布验收失败。

- 本地 101 项客户端测试通过。三桌面平台的真实包内管理端 116 项、Player 25 项模拟 API 检查分别通过，包内容边界检查通过。
- 两个 Mac 架构、两个客户端均使用 Developer ID Application 签名及 hardened runtime；应用和 DMG 经 Apple 公证，票据已附加。最终 ZIP 解包应用、DMG 的签名/票据/Gatekeeper 检查全部通过，来源为 `Notarized Developer ID`。
- iOS 3 项原生测试、47 项 iPhone 模拟器流程通过；未签名真机目标编译、签名 archive/export 及导出 IPA 的签名/发布权限核对通过。版本 `0.10.2`、构建号 `17.1`、Bundle ID `org.coopbench.ios`。
- App Store Connect 校验及上传成功，Apple 处理状态 `VALID`，内部测试状态 `IN_BETA_TESTING`。`Coop Bench Internal` 组启用自动分发，只有持有人一个测试者，页面显示一个构建和 `Invited`。未邀请其他人，未提交外部 Beta 审核或正式 App Store 审核。

## 下载及更新验证

12 个 Release 附件：管理端和 Player 各含 Windows x64 EXE、Mac x64/arm64 DMG/ZIP，共 10 包；另有同版 iOS Xcode 工程 ZIP 和 SHA256SUMS.txt。所有 11 个文件的本地 SHA-256、校验清单与 GitHub asset digest 一致。

使用与 0.10.1 相同的更新器代码、旧版本号和无凭据的公共请求，验证 Windows/Mac x64/Mac arm64 均发现 0.10.2；Windows 完整下载 111534006 字节并通过 SHA-256 校验，未启动安装。iOS 工程完整下载 169850 字节并校验通过。

- Windows 管理端 SHA-256：`d28591a16f91d0d44eb5162f21765b5d0bb1a6af0e892cb6cfa65cd97d540c61`。
- iOS 工程 SHA-256：`c9c79152c8f1943ea341783c11ab7001258d57910d9b49f9a24015ad5d40bd72`。

## 后续使用和维护

Mac 用户继续通过 GitHub Releases 或现有检查更新下载。iPhone/iPad 用户在 TestFlight 接受邀请后安装，后续由 TestFlight 更新，无需本地 Mac。Xcode 工程保留用于可选自建，不能直接作为手机安装包。

经持有人明确授权，签名 P12/密码、描述文件及 App Store Connect API key 存入该仓库 Actions Secrets；私钥不进入代码、安装包或公开附件。CI 使用临时钥匙串/文件并清理，详细配置见 [Apple signing](apple-signing.md)。Apple Distribution 证书及描述文件到期前需续期；当前到期日 2027-09-22，Developer ID Application 到期日 2031-09-17。

Windows 尚未代码签名。CI 的 Mac Gatekeeper、原生/模拟器结果不等于用户实体 Mac/iPhone 安装验收；实际钥匙串交互、麦克风和前后台行为仍须真机验证。此次未改动后端、配置、数据库、历史对局或部署。
