# 0.11.10 手机操作、入席署名与直播回放交付

版本/tag提交 00353ba，包含[0.11.9候选五项改进及定位记录](release-0.11.9-delivery-2026-09-22.md)。0.11.9候选因完整验收未通过而取消，未公开或上传TestFlight。

额外修复创建目录就绪状态：登录的游戏目录请求与回放列表并行，目录未返回时新建窗口原来可点击但三个必填下拉框为空，HTML校验阻止提交而没有明确加载说明。新窗口等待共享目录请求，加载时禁用创建按钮、显示状态，失败可重试。同会话目录读取合并；旧会话响应不能覆盖新会话。iOS模拟器诊断确认旧实现没有发出POST /rooms，游戏/场景/人数均为valueMissing。新增确定性单元覆盖加载中禁止创建、请求合并、完成后启用和失败保留重试。

Mac签名包验收外层独立钥匙串脚本由150秒协调至管理端270秒，内层240秒，Player保持150/90秒；只延长整套审计读取验收预算，不放宽任何功能断言或生产限流。独立临时钥匙串与签名/Gatekeeper要求保持。

本地124项单元、0.11.10管理端133项通过；正式四平台流水线 [35717494086](https://github.com/neutralino-ai/coop-bench/actions/runs/35717494086) 全部成功，包括各桌面开发与真实包内管理端133项、Player25项，以及iOS原生和模拟器75项。两种Mac架构的管理端/Player最终ZIP与DMG均签名、公证、附票据并获Gatekeeper accepted；报告保存在 artifacts/v01110-official-signing 与 artifacts/v01110-official-desktop。

独立iOS运行35717434696与正式发布的模拟器75项均全部通过：room-create-ready、创建成功、账户署名、手机版布局、恢复立即刷新均通过。正式network-fixture确认immediateResumeVerified=true、droppedAcceptedResponse=true、identicalActionRetries=1、POST /rooms返回201。实际iPhone模拟器牌桌截图位于artifacts/v01110-official-ios/player-mobile.png，保留本席信息边界。模拟器将原席位恢复的首个wait限定timeoutMs=0，并检查网络夹具immediateResumeVerified；真实设备麦克风、语音识别取消耗时及安装体验尚未验收。

[公开Release 0.11.10](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.10) 于2026-09-22 11:01:50 UTC发布，12附件包含同版Xcode工程，tag保持00353baef43dc958d30449a98938a1e56c9bb0a7。签名维护者为Xuefeng Ding，Apple Team YN64A93R4Z。TestFlight上传成功后只读核验0.11.10（32.1）为VALID / IN_BETA_TESTING，build id f12ed598-0d21-4529-91c8-0b8174611599；外部测试状态为READY_FOR_BETA_SUBMISSION，未声称外部审核通过。证据 artifacts/apple-0.11.10.json。

[公开下载验收35719217813](https://github.com/neutralino-ai/coop-bench/actions/runs/35719217813) 成功：无认证访问公开Release，12附件和11条包校验和对应；旧0.10.1版本选择逻辑在Windows和两种Mac架构均发现新版，实际下载111545498字节Windows安装包并校验SHA-256，183950字节同版iOS工程也完成下载校验。报告保存在 artifacts/v01110-public-download/verification.json。

仅更新公开客户端，没有改动部署后端、旧34935或真实对局。签名使用维护者既有身份。iOS源码包、签名IPA上传、Apple处理与真机验收分别记录。
