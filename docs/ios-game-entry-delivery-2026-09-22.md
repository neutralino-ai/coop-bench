# iPhone 开局后 HTTP 400 修复

用户在 TestFlight 0.11.0 (20.1) 加入房间成功，但房主开局后进入牌桌出现 HTTP 400 / INVALID_REQUEST 并反复重连。

## 根因与修复

原生 SeatRuntime 在获取观察之前初始化本席轨迹序号，调用 `/episodes/{id}/messages?after=-1&limit=500`。消息接口的分页范围是 1–100，500 是观察更新接口的上限。请求在初始化阶段被拒绝，无法继续到 rules / wait。共享此运行器的手机人类玩家和内置 Agent 都受影响。

0.11.2 将消息分页改为 100，保留 nextAfter / hasMore 循环与原有席位存储。没有修改服务端、放宽校验、重置账号或操作生产对局。

此前 iOS 模拟器验收使用的合成接口忽略了 limit，故错误请求也得到成功响应。现合成接口拒绝超限及非法分页，并真实切分消息列表；原生开局验收会经过该校验。新增 205 条历史、空流、恢复游标和席位隔离回归。

## 已完成验证

- Node 24.21.0：105 项客户端测试通过。
- Windows 开发态实际窗口：120 项验收通过，0.11.2 / x64 / packaged=false。
- 私有服务器隔离 PostgreSQL：旧请求 400 / INVALID_REQUEST，新请求 200，205 条历史为 100 / 100 / 5，随后 rules 与 wait 均为 200。合成凭证与数据，无生产数据库访问。脚本位于私有 server/artifacts/ios-entry-regression.ts。
- 初次本机构建和 initdb 被沙箱环境限制阻止，正常本机隔离运行后通过；未修改安全校验或生产环境。

## 发布状态

候选提交 fc1fc47，独立工作树 client/artifacts/ios-game-entry，分支 codex/ios-game-entry-fix。
四平台签名及 TestFlight 候选 CI：https://github.com/neutralino-ai/coop-bench/actions/runs/35694004562。
0.11.2 是中间候选，未作为正式版本发布；合并后以 0.11.3 正式签名流水线 35696757070 交付。0.11.3 标签流水线后来按新增 UI 要求取消，最终以 0.11.4 交付；见 [交付记录](release-0.11.4-delivery-2026-09-22.md)。
