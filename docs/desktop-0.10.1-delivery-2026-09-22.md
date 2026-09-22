# 0.10.1 理由与实时回放

发布提交 `895201ebe808f421b8c668c91b7fed21d0adbf88`，正式流水线 [35675320034](https://github.com/neutralino-ai/coop-bench/actions/runs/35675320034)。Windows、Mac Intel、Mac Apple Silicon、iOS 及发布任务全部通过。北京时间 2026-09-22 09:31:47 [正式发布](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.10.1)，12 个附件包含同版本 iOS 工程。

## 行为

- “我创建的”仅含等待开始和进行中的房间，管理按钮在右侧。
- 房间保留入席设置、开始、踢人、强制结束。回放和输入审计统一从回放页进入。
- 进行中回放默认到最新步骤；停在末尾时跟随，查看历史时保留选中步骤。滚动、展开的轨迹块在刷新时保持。
- `decisionSummary` 继续是可选 HTTP 字段；人类可选填。内置 Agent 工具要求中文理由，漏填、空白、超长或纯英文先进入有限修正流程。外部 Agent 文档要求理由，MCP/JSONL 桥接要求此字段。
- 理由独立于动作，不传给队友。桌面及 iOS 的人类、模型动作均保存理由，运输重试保留同一请求内容。
- 内置 Agent 的录制内容在理由区域显示为彩色卡片，包括初始 prompt、模型输入、实际返回的推理/摘要/回复、工具调用和结果。最新在上，提交理由高亮，分片校验 SHA-256 后重组，可继续分页读取。
- 旧局没有保存的理由、提供方未返回的内部思考不能补造。原始输入审计依然用于核对服务器签发内容及运行器转交的请求，区别于模型决策轨迹。

## 验证与边界

客户端单元及边界测试 101 项通过。Windows 开发态及实际包内管理端均 116 项通过，实际包内 Player 25 项通过；iOS 3 项原生单元、47 项模拟器流程及未签名设备 Release 编译通过。正式 CI 逐平台执行真实包内 UI 验收与文件边界检查，发布任务依赖全部桌面及 iOS 成功。

iOS 语音采用 Apple Speech / AVAudioEngine，点击按钮才申请权限。支持时使用设备内识别，否则由 Apple 语音服务识别；不保存录音。用户采用文字后写入可编辑草稿，确认动作才提交；取消、后台切换不会提交。原生实现参考 [Apple 实时语音请求文档](https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest)。

iOS 工程用于自己的 Mac / Xcode 自签安装，不是已签名 IPA 或 TestFlight。模拟器检查未覆盖实体 iPhone 麦克风和实际听写准确率。

## 公开更新验收

真实 0.10.0 更新器直接请求公开 GitHub API，发现 0.10.1；三种桌面平台安装器选择正确。Windows 完整下载 111534029 字节并校验 SHA-256 `9daf1dddbe28c4a56d04ce306bf2463cc5db2edfd279d6fad6cdbaafafe821c7`，未安装。iOS 工程完整下载 169446 字节并校验 `sha256:486ee4829e7fcd21e8f234d11c3db83de465239176076b877b0cd1971ce0407d`。全部公开 SHA256SUMS 与附件摘要一致。
