# 0.11.5 交付记录

0.11.2 为中间候选；0.11.3 的正式标签流水线 35696757070 在用户追加紧凑轨迹卡要求后主动取消，未公开 Release 或完成 TestFlight 上传。0.11.5 包含上述修复与最终轨迹优化，用户已明确授权正式 Release 与 TestFlight。

轨迹默认仅一至两行必要内容，类型、时间、详情共一行。五类用固定颜色区分：User/System 蓝、Assistant 紫、Thinking 黄、Tool use 橙、Tool result 绿。详情惰性展开，完整正文与结构化字段保留。模型设置和工具定义移入输入详情；服务器帧确认仅在观察编号、请求编号及提交动作都能对应时与已有成功回执合并。无法对应、拒绝和自动动作证据保持独立，不按文本近似去重。

本轮动作工具调用加边框和标签并优先显示。历史使用动作绑定的观察编号和请求编号；进行中使用同一行动窗口或观察编号，且必须是当前必需行动者。不用相同动作文本或相近时间猜测。展开与手工滚动状态在刷新中保持。

包含 iPhone 0.11.0 (20.1) 开局消息分页修复、实时行动者与服务端倒计时、菜单连接灯强制检查、单行可拖动时间条、合并手牌提示标题和扩大轨迹区。服务端超时新策略已在没有活动对局及有效等待房间时独立上线；新局可弃则弃首牌，否则出首牌，旧局保持原策略。用户已澄清 Agent 卡住可能是网络卡顿，本次没有据此改写运行器重试状态机。

本地110项单元测试通过；Windows实际安装包126项通过。0.11.4 标签流水线35698387348在完成前取消：补查发现同观察下重复动作需按请求编号关联高亮，修复后升为0.11.5，未改写已公开标签。模拟器原生验收包含严格消息分页、完整详情、五类紧凑块、高亮以及丢失成功响应后按相同幂等键重试。

实体 iPhone/Mac 安装和使用仍须设备验收。签名身份为仓库已有维护者 Apple 配置，材料仅在 Actions Secrets；公开工程不含签名密钥、私有后端或生产数据。Xcode ZIP 不称为签名 IPA。

最终 0.11.5 提交/tag：`3eb50a04f17e5bfa0583d79a74ec5e75e8f64547`，正式签名流水线 [35698630310](https://github.com/neutralino-ai/coop-bench/actions/runs/35698630310)。本机最终0.11.5包内126项通过，1280×800下五张折叠卡可同时显示；[公开 Release](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.5) 于2026-09-22 07:34:53 UTC发布，12个附件含同版Xcode工程。旧0.10.1更新器实际识别新版、下载111542919字节Windows安装包并校验SHA-256；iOS工程180739字节也实际下载校验通过。

已读取最终 CI 证据：Mac ARM 管理端126项/Player25项，签名、公证票据及最终ZIP/DMG的Gatekeeper全部accepted；iOS模拟器68项，网络夹具确认 droppedAcceptedResponse=true、identicalActionRetries=1。Windows/Mac的1280×800及iPhone截图已检查。Apple签名身份为维护者 Xuefeng Ding 的既有配置。

最终四平台、TestFlight上传和发布流水线35698630310全成功。Intel和ARM管理端/Player签名、公证、票据及最终包Gatekeeper均通过；iOS签名包为0.11.5（27.1）。Apple只读复查：processingState=VALID，internalBuildState=IN_BETA_TESTING，externalBuildState=READY_FOR_BETA_SUBMISSION，已有内部测试分发可用，未声称外部测试审核已通过。build id为2e15a768-5255-4f93-9933-d3409aa70180。实体设备仍未验收。

本机证据位于忽略目录 artifacts/v0115-packaged、v0115-ci-mac-arm、v0115-ci-ios、v0115-ci-signing-arm、v0115-ci-signing-intel、v0115-ci-signing-ios、v0115-release-verification。服务端新策略独立完成空闲部署，旧34935与历史数据保持；本客户端公开仓库不含服务端部署材料。
