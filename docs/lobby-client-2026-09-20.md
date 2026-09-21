# 大厅与人类参赛开发版验收

日期：2026-09-20。Windows 11 / x64（10.0.26200），Node 24.21.0，pnpm 11.19.0，Electron 44.4.1。本地开发构建版本仍为0.9.1，未创建公开Release，未提交或推送。Mac Intel/Apple Silicon 本次未构建，真实安装向导与Mac钥匙串不在本次验收范围。

## 功能

- 顶部“加入对局”打开自动刷新的大厅，可看见开放房间的人数、场景、玩家与名称，直接入席。
- 新对局提供名称、参与方式、行动时限；保留邀请和Agent直接开局。
- 主客户端直接打开人类参赛窗口，支持准备、房主开始、离开、断开及恢复。本席窗口只有Player桥接，不得到人工账户、席位凭据或其他席位私有观察。
- 房间名称作为文本呈现，贯穿大厅、玩家界面、记录与回放。缺失名称时显示游戏名称。
- 依赖服务端 `GET /lobby`、`POST /lobby/:id/join` 和建房 `allowHumans` / `name` 参数。未改默认服务器地址或旧对局。旧服务拒绝时不自动删参数重试。

## 验证

- 客户端78项自动测试全部通过，包括既有连接、认证、原始记录、运行器时限和协议测试。
- 真实打包的主客户端60项、独立Player14项验收通过。数据来自临时回环模拟API，验证客户端交互，不是游戏核/真实模型得分测试。
- 包内流程覆盖命名创建、公开/邀请房间区分、发现、加入、离开释放座位、准备、开始、合法表单动作、隐藏本人手牌、断开恢复同一席位、名称在记录及回放中保留。
- 两个ASAR均通过27文件显式白名单及逐字节核对，`remoteOnly=true`、`containsGameEngine=false`。
- 相关私有服务端另有SQLite大厅/时限13项及真实PostgreSQL房间/大厅5项通过，包含跨实例争抢最后席位、房满、过期、邀请隔离和原子开局。后端部署由独立任务负责，这些本地结果不代表线上已升级。

构建标识：`ebf374584c3b5dd7905f045d64b4ea34c29de57320cb175d4eebd0d2da384113`。

原始证据在忽略目录：`artifacts/tests-lobby-node24.21.log`、`artifacts/lobby-packaged-final/client-smoke-result.json`、`artifacts/lobby-player-packaged/player-smoke-result.json`，截图包含`client-lobby.png`及`client-human-game.png`。最终主客户端截图等待隐藏测试窗口完成重绘后采集，已目视核对大厅及人类牌面。

安装包：`release/Coop-Bench-0.9.1-win-x64.exe`、`release-player/Coop-Bench-Player-0.9.1-win-x64.exe`。这是本地未发布构建，不能与公开同版本旧包混淆；正式发布前仍需更新版本并通过三平台CI。

交接期间部分编辑曾被源目录同步覆盖，已从本任务原始补丁恢复；上述包内结果均来自恢复后且包含命名功能的最终构建。
