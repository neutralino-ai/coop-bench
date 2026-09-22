# 0.10.3 大厅入口精简交付

2026-09-22 北京时间 12:53:44，[0.10.3](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.10.3) 正式公开发布。版本/tag 提交为 `2e1d19c76cea77d79d41bc15d6a943a11ae9edb3`，main 与 `codex/replay-decisions` 均指向该实现。

## 行为

- “可加入的房间”移除重复的“返回我的对局”和“管理房间”，只保留刷新、房间卡片和按房间 ID 加入。
- 已参与对局继续从“我参与的”进入；自己创建的等待中或进行中房间继续从“我创建的”右侧“管理房间”进入。
- 管理房间、恢复对局、入席、回放和后端协议均未改变。本次没有部署后端、重启服务或中断对局。

## 构建与发布

[正式 CI 35687709879](https://github.com/neutralino-ai/coop-bench/actions/runs/35687709879) 的 Windows x64、macOS Intel、macOS Apple Silicon、iOS、TestFlight 上传及发布任务全部成功。两套 macOS 管理端和 Player 继续使用 Developer ID 签名、公证及票据，并通过最终包验证。

客户端 101 项单元与边界测试通过。正式 Windows 产物中，管理端开发态和包内各 116 项、包内 Player 25 项通过；iOS 47 项模拟器流程、原生测试、未签名实体设备目标编译、签名导出及 TestFlight 上传通过。iOS 签名记录为版本 `0.10.3`、构建号 `19.1`、Bundle ID `org.coopbench.ios`。上传成功不等于 Apple 已完成处理，也不等于实体 iPhone 安装或麦克风验收。

## 公开更新验收

Release 有 12 个附件：管理端和 Player 各五个 Windows/macOS 安装包、同版本 iOS Xcode 工程及 `SHA256SUMS.txt`。与 0.10.2 完全相同的更新器实现通过公共 GitHub API 发现 0.10.3，并正确选择 Windows x64、Mac x64 和 Mac arm64 包。

Windows 安装包完整下载 111533709 字节，SHA-256 为 `bd8404254c27feacfd0848df8c74597f7c8f1a816b8368ff8b3feaa7b7ebd268`；iOS Xcode 工程完整下载 169727 字节。两者均与 GitHub asset digest 一致，全部公开附件也与 `SHA256SUMS.txt` 一致。验证没有启动安装程序。
