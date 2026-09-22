# 0.11.11 移除高级直接开局

按用户要求关闭创建页面“Agent 直接开局（高级）”，统一使用房间创建、玩家入席准备、房主开始的流程。没有改动私有服务端实验 API、部署或正在进行的对局。

删除参与方式选择、createEpisode / showSeats、旧创建忙状态、批量席位配置面板与复制逻辑、专属样式、未读取的房间邀请码和席位缓存。保留房间原生权限与逐席 Coding Agent 提示词、内置 Agent、seat token、恢复和房主开局。表单提交与点击创建使用同一房间请求，始终 allowHumans=true；保留目录就绪检查、防重复提交和跨会话响应隔离。

桌面 RemoteSession 与 iOS Endpoint 的管理界面 POST 白名单移除 /episodes，已有对局审计/中止和 /rooms 开局保持。增加两端拒绝旧路由的边界断言。消息分页测试从直接创建改用房间创建、逐席入席/准备和房主开始，保留分页及另一席消息不可见的检查。mock API 的直接创建路由及桌面旧流程验收删除，桌面/iOS 验收检查旧控件不存在。

版本/tag `651c917238eb7b02f6793982e22f0dd4547aa0bc` / `v0.11.11`。本地124项单元全部通过；桌面开发应用131项通过（功能代码相同，测试运行时尚标记0.11.10，最终0.11.11版本由CI验收）。证据位于忽略目录 artifacts/v01111-tests.log 与 artifacts/v01111-smoke。

正式流水线 [35720412577](https://github.com/neutralino-ai/coop-bench/actions/runs/35720412577) 的四平台与TestFlight上传全部通过：各桌面开发和实际安装包管理端131项、Player25项，iOS原生/模拟器76项。桌面被删除功能的旧断言已替换为房间流程验收；131项相较旧133项的减少来自被删除的直接发牌/批量席位配置分支。iOS新增room-only-creation-no-direct-deal检查，创建页截图已核对；网络夹具继续验证待确认动作恢复。

两种Mac架构的管理端及Player最终ZIP/DMG签名、公证票据、Gatekeeper均通过。签名维护者为Xuefeng Ding，Apple Team YN64A93R4Z；iOS签名构建为0.11.11（33.1）。证据位于 artifacts/v01111-official-windows、artifacts/v01111-official-mac、artifacts/v01111-official-ios、artifacts/v01111-official-signing。实体设备未验收。

[公开Release](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.11) 于2026-09-22 11:35:31 UTC发布，12附件含同版iOS工程；正式流水线连同TestFlight和发布全部成功。Apple只读查询0.11.11（33.1）为VALID / IN_BETA_TESTING，build id 48c47f14-4d62-4666-9446-ce69654cbe31。外部测试状态READY_FOR_BETA_SUBMISSION，不声称外部审核或实体设备验收完成。

[公开下载验收35722431356](https://github.com/neutralino-ai/coop-bench/actions/runs/35722431356) 全通过：不携带认证信息读取12公开附件并核对11条安装包/工程SHA-256，旧0.10.1更新选择逻辑发现新版，实际下载Windows安装包及同版本iOS源码ZIP并校验。证据 artifacts/v01111-public-download/verification.json 与 artifacts/apple-0.11.11.json。共享client、server的既有未提交修改保持。
