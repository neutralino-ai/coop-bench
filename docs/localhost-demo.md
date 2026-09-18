# Localhost 服务与三个 Agent 试玩

## 服务

当前研究服务使用 `http://localhost:8788`，API 前缀为 `http://127.0.0.1:8788/api/v1`。
监听地址固定为 **127.0.0.1**，其他电脑不能直接连接；不会使用 DDNS 域名对外发布。
服务状态写入 `data/local-server/episodes.sqlite`，关闭进程后数据仍保留。

在项目目录运行（Windows / macOS，Node.js 24+）：

```text
node scripts/serve-local.mjs
```

这是一个持续运行的进程；前台运行时用 Ctrl+C 停止。端口占用会明确报错，不会悄悄换端口。
可通过环境变量 `PORT` 改端口、`COOP_DATA_DIR` 改数据目录。
当前演示由后台进程运行，不需要重复启动；未配置开机启动。

网页创建对局需要协调者凭证。该凭证在 `data/local-server/coordinator-token` 中，手动复制到网页的“协调者凭证”输入框即可；不要交给玩家。
本入口不把凭证打印到日志。连接信息文件 `connection.json` 不含凭证。

## 演示：Take Time 1-1

本次使用三个独立子智能体，通过 HTTP 接口完成 **Chapter 1, Clock 1（第 1 章第 1 个时钟）**。
使用一次未筛选的随机发牌；不代表完整战役或稳定胜率。

- 24 张牌：太阳和月亮各 1–12，随机发出 12 张，每人 4 张。
- 看牌前讨论；每名玩家看牌后禁言。所有人看牌后开始放牌。
- 本次安排两轮讨论，每人每轮一句，之后 p1 先放牌，p2、p3 依次行动。这是演示调度，不是额外官方限制。
- 每次放一张；暗置时，其他玩家可见位置、颜色和放牌者，看不到数值。
- 全队最多明置 3 张，可以一张也不明置；不是前三张必须明置。
- 六格都必须有牌，合计值从第 1 格到第 6 格不递减；相等合法。
- 第 1 格恰好一张太阳牌；第 6 格恰好三张牌。

## 给 Agent 的接口

协调者创建对局，给每个玩家一份仅含自己 `seatToken` 的座位文件。
本次桥接脚本把工具操作转成真实 HTTP 请求：

```text
node scripts/player-action.mjs PATH/TO/seat.json read_rules
node scripts/player-action.mjs PATH/TO/seat.json observe
node scripts/player-action.mjs PATH/TO/seat.json send_message PATH/TO/message.json
node scripts/player-action.mjs PATH/TO/seat.json act PATH/TO/action.json
```

发言请求示例：

```json
{
  "requestId": "p1-discuss-1",
  "action": {"type": "speak", "text": "这里填写看牌前的公开策略讨论"},
  "decisionSummary": "这里填写简短决策理由"
}
```

查看自己的牌：`action` 为 `{"type":"look_hand"}`。
出牌参数应读取当前 `legalActions`，不能猜测牌 ID 或跳过规则检查。
`send_message` 走同一个动作端点，因此静默阶段不能绕过引擎聊天。

每个座位的最近观察保存在自身目录中。提交使用该观察的 `observationId` 和 `decisionToken`；不会在决策后偷偷刷新观察。
脚本在发请求前保存内容，以便网络失败后用相同 `requestId` 和内容重试。明确收到过期观察错误时，重新观察，重新决定并使用新的请求 ID。

## 复现实验流程

```text
node scripts/demo-coordinator.mjs create artifacts/ANOTHER-UNIQUE-DEMO
# 分发各自的 seat.json，开始观察、讨论、看牌、出牌。
# 结束后导出：
node scripts/demo-coordinator.mjs export artifacts/ANOTHER-UNIQUE-DEMO
```

协调者脚本使用默认 `data/local-server` 下的连接信息；自定义数据目录时需调整该脚本或直接调用 API。
已有演示目录禁止覆盖。创建成功会返回新的随机对局，不提供挑选 seed 的入口。

导出文件：

- `audit.json`：服务端时间、已签发的玩家观察、提交动作、简短理由、拒绝记录、终局全量状态。
- `training.json`：每次决策对应本人的观察与动作、终局团队奖励。需要进一步筛选，不能自动当作高质量 SFT 示范。
- `replay.json`：逐步重放并检查状态哈希的结果。

完整审计只在对局结束后开放给协调者。它含全部牌和种子，不能作为玩家输入。
试玩使用新建的玩家上下文和独立座位凭证；同一系统账号共享文件目录，因此这是按协议限制读取的演示，不是对抗恶意 agent 的文件系统沙箱。
简短决策理由是玩家主动提供的说明，不是隐藏思维链；赛后反思单独保存，不混入当时的模型输入。

实际试玩记录见 [2026-09-17 审计报告](../artifacts/http-agent-demo-2026-09-17/report.md)。

本次实际结果：团队获胜，六格总和为 `1、10、11、14、22、25`；21 个动作通过逐步重放。
报告生成器为 `scripts/report-take-time-demo.mjs`，在导出并收齐三个玩家的 `reflection.md` 后运行：

```text
node scripts/report-take-time-demo.mjs artifacts/http-agent-demo-2026-09-17
```

`scripts/check-demo-counterfactual.mjs` 用于赛后固定其他动作的对照复算，不创建或修改真实 HTTP 对局，也不替换训练结果。
