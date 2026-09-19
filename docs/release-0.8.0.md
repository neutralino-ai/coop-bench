# 0.8.0：邀请房间、参赛运行器、独立 Player

日期：2026-09-19。源码与 Windows 本机交付；**没有部署腾讯云，没有发布版本 tag，没有调用真实付费模型**。原线上 API 的能力不能据此更新为 0.8.0。后续部署需先备份数据库、归档旧 runtime 并保留旧 build 回放；本次未修改历史 episode build。

## 行为变化

- 管理客户端增加“创建邀请房间”：人齐并确认当前成员后再发牌，管理员无需分发或持有玩家的入席密钥。支持查房、撤销成员、重新生成邀请及原子开局；旧直接建局接口兼容。
- 服务器按本席发送持久 SSE 观察；运行器保存游标、累计未交付更新、自动唤醒决策者、用 POST 及持久幂等键提交动作。连接失败不会让已执行动作再执行一次。
- 新局固定 60 秒必需行动窗口、60 分钟整局运行预算，后台扫描不依赖任何玩家在线。非法请求、聊天、重连和日志上传不续时。适配器区分轮流、多人准备、团队推进和官方计时阶段；具体政策见 [会话说明](player-sessions.md#固定期限)。
- **Coop Bench Player** 是独立的 Windows / Mac 参赛应用，有人工和最小模型 API 模式；花火提示池、失误、牌堆、私有提示知识与动作表单可直接查看。其他游戏使用通用字段与合法动作 Schema。
- 无界面 `scripts/player.mjs` 支持模型 API 或外部 Agent JSONL。模型接口保留实际请求、响应、工具调用/结果及实际返回的 reasoning，认证头不入日志，轨迹先落本地待发队列后上传。外部框架内部 thinking 不能凭空获取，完成声明保守标 partial。
- Nginx 类比明确为多局共享 worker 的事件驱动设计。当前实现仍是单进程 SQLite；多 worker 的数据库 ownership epoch、租约和故障接管在设计文档中，尚未实现或压测。

## 验证范围

Windows x64，Node 24.21.0，Electron 44.4.1。游戏服务 build：`1f19827b58d3f90188c34ece2db796cd9f275cb17d12d9ad5ec88b5ffca772a5`。

| 验证 | 结果 / 证据 |
|---|---|
| `node --test test/*.test.ts experiments/*.test.ts` | 311 项通过，0 失败；本机证据 `artifacts/session-test-results.txt` |
| 新会话测试 | 准备版本、重复开局、空凭证权限拒绝、踢人后撤销邀请、开局失败事务回滚、无玩家连接时超时、重启保持期限、非法动作不续时、过期后的旧回执、SSE 单席隔离 |
| 运行器端到端测试 | 两席独立运行器 + 本机模拟模型 API 完成花火；模拟服务器提交后丢失响应；没有重复出牌；真实测试请求保留 updates、无 seat token / decisionToken / API key；返回的合成 reasoning 与完成声明均保存 |
| 管理端实际包内验收 | 42 项通过，包括原登录、规则、提示池、一屏审计、密码、更新、消息/附件及新增邀请房间；`artifacts/admin-packaged-verified/client-smoke-result.json` |
| 参赛端实际包内验收 | 10 项通过：邀请、准备/房主开始、本席可见性、提示池/期限、规则、人工动作、终局 SSE、轨迹、拒绝 audit IPC；`artifacts/player-packaged-verified/player-smoke-result.json` |
| Windows 安装器 | 管理端 `release/Coop-Bench-0.8.0-win-x64.exe`；参赛端 `release-player/Coop-Bench-Player-0.8.0-win-x64.exe`。验收运行的是打包后的 EXE，未代用户执行安装向导 |
| Mac | 构建配置及两客户端的原生 CI 已更新；本次没有本机 Mac/Gatekeeper/Keychain 手工实测。对应提交 CI 结果另行确认，不沿用旧版通过记录 |

所有本次测试使用隔离本机服务器和合成数据，无生产 owner 密码操作。模拟模型胜负不是 LLM 能力证据。Windows 安装器与 Mac 产物保持未签名/未公证发行方式；不建议通过关闭系统安全机制绕过提示。

本机交付安装器 SHA-256（CI 重新构建的产物需使用其各自摘要）：

```text
046dd18c387ebb72b85cb4407cea43970394b0b89b9234e00f3ad7bc692d4e51  Coop-Bench-0.8.0-win-x64.exe
7157f50033c996aa482265bffb28b1fcb2aa2818009146e3328a435a7cbdf5f3  Coop-Bench-Player-0.8.0-win-x64.exe
```

## 限制与后续接入

1. 新参赛客户端需要升级后的房间 API；旧生产服务缺路由时无法加入，不能归咎于用户名密码。
2. 没有新增 MCP 或长轮询；现有 GET observation 仍可主动拉取。邀请目前粘贴使用，不注册系统 URL 协议。
3. 提供方需支持 Chat Completions 工具调用格式；本次以本机模拟接口验收，没有声称全部商业模型已兼容。只返回摘要/不可读 reasoning 的接口不能当成完整内部思考。
4. 游戏服务与运行器使用本地持久存储，但没有实现分布式 worker 接管、全局运行器进程调度或 OS 级防作弊沙箱。所有游戏仍只覆盖既有核实场景，不是完整战役。
5. 新房间/运行器协议、使用命令、权限与超时边界以 [player-sessions.md](player-sessions.md) 为准。Mac 接手先读根目录 AGENTS.md 与 CLAUDE.md。
