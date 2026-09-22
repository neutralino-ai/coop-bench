# 0.11.0 两种角色与管理功能交付

客户端版本提交为 e9d4bd78b4426c5e66838ece32944bf83cc181b6，工作树 client/artifacts/member-login，分支 codex/operator-member-management；main 已含实现及 0.10.3 的入口精简。

只有 operator 和 member。管理员拥有普通成员全部功能，并可生成邀请码、查看用户、单个或批量禁用/恢复登录、删除账号、重置密码、单个或批量中止任意对局、删除已结束对局数据。member 没有管理按钮，但可回放和导出任意对局轨迹 JSON。客户端移除审阅批注。

删除账号保留历史对局与署名，不再分配该用户名；密码及登录会话移除。重置密码或禁止登录会撤销旧会话。删除对局仅允许终局，任何活动局使整个批次被拒绝；中止与删除为分别确认的操作。写入使用固定请求编号去重，网络中断后同一操作可安全重试。

此前 member 登录报“账号操作未完成”的原因：共享页面遗漏 member 身份，原生登录和服务器验证成功后页面仍报错。本版同时修复 iOS 和桌面，普通用户的注册、登录与连接状态均有回归覆盖。

## 已验证

[签名候选 CI 35690859160](https://github.com/neutralino-ai/coop-bench/actions/runs/35690859160) 全部成功，候选确切提交与上述版本一致。104 项客户端单元与访问边界检查通过；Windows、Mac Intel、Mac Apple Silicon 开发态及正式包各 120 项管理端检查，正式包 Player 各 25 项检查通过。两个 Mac 架构的管理端/Player 均签名、公证、附票据，最终 DMG/ZIP Gatekeeper 接受。

iOS 原生测试、58 项模拟器流程、实体设备目标编译及签名导出通过；截图确认管理表格和邀请码页面可在手机显示。iOS 0.11.0 (20.1) 已上传 TestFlight，Apple API 返回 VALID / IN_BETA_TESTING；分发保持现有内部测试者，未新增测试者。模拟器和签名证据不等于实体 iPhone 安装或麦克风验收。

配套当前 PostgreSQL 服务已上线，账号、密码与历史保留，旧服务未改动。后端验收与部署材料留在私有仓库，不进入公开包。

## 公开发布

2026-09-22 13:47:54 北京时间，[0.11.0](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.0) 已正式发布，tag 指向上述准确提交。12 个附件（10 个桌面安装包/压缩包、同版 iOS Xcode 工程及 SHA256SUMS）全部与成功 CI 的产物摘要一致。发布使用已成功的手动签名 CI 35690859160；标签触发的重复 CI 35692122476 已取消，避免重复上传 TestFlight。

0.10.3 更新器实际从公开 API 发现 0.11.0，三种桌面架构安装包选择正确；Windows 安装包完整下载 111538108 字节，SHA-256 为 67c23a10b9d2836c6c8e427a058a59c181fee3bec30e1859ff62b1afba7e5f7c。iOS 工程完整下载 175597 字节且摘要一致，所有 12 个公开附件校验清单一致。未执行安装器。证据在 artifacts/public-update-verification-v0110.json、public-release-v0110.json、testflight-v0110-state.json 及 ci-v0110-*。
