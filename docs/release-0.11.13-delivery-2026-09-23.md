# Coop Bench 0.11.13 交付记录（2026-09-23）

0.11.13 已正式发布：[GitHub Release](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.13)。客户端代码先快进合并到公开 `main`，版本标签固定在 `20dc7d130819bb09efc55351f0d59fc59b7ef761`。本版的 iPhone Player 手牌按席号排，去掉人类理由和语音输入；队友自上次行动后的动作和完整历史默认展开，提示、出牌、弃牌各用紧凑一行。终局回放优先展示 Coding Agent 已上传的真实 transcript 或内置 Agent 消息流，System 独立成第六色块；移除了独立实际模型请求窗口。管理员清单在窄屏显示分数、人数、成员与结束原因，删除/中止前再次核对。

正式标签 [工作流 35825172671](https://github.com/neutralino-ai/coop-bench/actions/runs/35825172671) 全成功：Windows x64、macOS Intel、macOS Apple Silicon、iOS 原生与模拟器；Mac 管理端和 Player 签名、公证、staple 与最终 DMG/ZIP 的 Gatekeeper 检查均通过；iOS 签名 IPA 已上传 TestFlight。之前同一提交的签名准备工作流 `35822625018` 也全成功。候选验证记录有 130 项单元、桌面管理端 133 / Player 28 项、iOS 模拟器 88 项；正式流水线再次运行相应测试。实体 iPhone/Mac 安装体验未验收。

Release 为公开正式版，12 个附件均处于 `uploaded`，含桌面管理端/Player 的 Windows、Intel/Apple Silicon Mac 安装包、`SHA256SUMS.txt` 和同版本 `Coop-Bench-0.11.13-iOS-Xcode.zip` 源码工程。工程 ZIP 不是可安装 IPA。[公开下载验收 35827096582](https://github.com/neutralino-ai/coop-bench/actions/runs/35827096582) 成功：旧 0.10.1 更新器识别新版，无凭证实际下载 Windows 包并核对大小与 SHA-256；同版 iOS 工程也实际下载并校验，11 个文件摘要与 Release 元数据相符。公开 Windows 管理端安装包为 111547958 字节，iOS 工程为 185109 字节。未自动安装或中断本机客户端。

App Store Connect 只读查询：正式上传的 iOS `0.11.13 (38.1)` 为 `VALID / IN_BETA_TESTING`。这说明已通过 Apple 处理并进入内部测试状态，不等于测试者已安装或实体设备验收。前一条同提交的准备运行构建 `37.1` 也已处理；正式交付以标签运行的 `38.1` 为准。

此版管理员清单依赖新的 `GET /api/v1/operator/games`。用户另行明确授权后，私有服务 34936 在活动对局 0、有效等待房间 0 时切换至 build `a4447b872d0cad6110a6b389166acb8cad5f0f9246a3a437f189de364e11be7a`，并给代理只增加该精确 GET 路由。公网新 build 正常，未经认证访问新路由为 401；旧 34935 健康、历史/账号/房间摘要前后保持。部署审计和回滚边界见私有服务端记录；未用真实 operator 会话从公网读取该清单。外部 Coding Agent 的每次理由和完整轨迹仍依赖其按接口要求提交/上传，客户端不能保证第三方工具的隐藏思考可得。

个人 `boardgame-ui-polish` skill 已另存于个人 skills 目录，没有放进公开客户端仓库。
