# 0.11.1 创建房间背景统一

“创建新房间”弹窗原先继承浅色背景，内部 create-panel 又单独使用白底，因此标题、边缘与表单呈现不同色块。现将该弹窗设为白底，标题栏继承同一背景，内部表单透明，创建表单及房间成员页均保持连续白色背景。

修复限定在共享 CSS 的创建房间弹窗，桌面与 iOS 共用；不改变房间操作或服务端。

版本/tag 提交 a96c60aab9eed5b1811292a6e326cc56ea1b285b，分支 codex/room-background，工作树 client/artifacts/member-login。本地104项测试和Windows开发态120项实际窗口验收通过，已查看创建表单及房间成员截图。新增创建表单截图到已有桌面和iOS验收流程。

[正式 CI 35692621925](https://github.com/neutralino-ai/coop-bench/actions/runs/35692621925) 的四平台、TestFlight 上传及发布全部成功。三平台开发态及正式包管理端各120项、正式包Player各25项；iOS原生测试、59项模拟器流程、设备目标编译及签名导出通过。两个Mac架构的管理端与Player签名、公证和最终包Gatekeeper验收通过。已查看正式Windows包与iPhone模拟器的创建房间截图，确认背景一致；未作实体设备安装验收。

2026-09-22 14:13:09北京时间，[0.11.1](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.1) 已正式发布，12个附件含同版iOS Xcode工程。0.11.0更新器已实际发现新版，Windows完整下载111538169字节、SHA-256 2357b934718a8d2988837a14d6afcbc6be446a8ec02409cf16be25d474e2c94e校验通过；iOS工程完整下载175624字节、摘要一致，所有公开附件校验清单匹配。未执行安装器。

iOS0.11.1(22.1)已完成Apple处理，API返回VALID / IN_BETA_TESTING，现有内部测试者可在TestFlight更新。未增加测试者或改变分发范围。

本次仅修改公开客户端，未操作后端、代理或任何对局。证据：artifacts/ci-v0111-*、public-update-verification-v0111.json、public-release-v0111.json、testflight-v0111-state.json。
