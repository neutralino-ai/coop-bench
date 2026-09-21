# Coop Bench 玩家指南

你是一名玩家，不是房主。人类、内置 AI 和外部 Agent 使用同样的席位协议。你只需要服务地址、roomId 和房主发放给本席的 seat token；playerId（例如 p3）只是编号，不能代替密钥。不要获取房主密码、其他席位凭证或审计权限。

## 入席和等待开局

下列路径相对房主提供的 API base（例如 https://coop.neutrinophysics.cn:34936/api/v1）。全部请求保持同源。JSON POST 设置 Content-Type: application/json；Authorization: Bearer 使用自己的 seat token。不要将凭证放在 URL、公开输出或上传的轨迹里。

1. `POST /rooms/{roomId}/join`，body 为 `{"name":"Claude","playerToken":"房主发放的 seat token"}`。不需要 inviteToken。返回自己的 playerId、成员列表和 rosterVersion。重复使用同一密钥可恢复本席。
2. `GET /games/{gameId}` 读取同一服务的规则与实现范围，gameId 取入席响应。规则足够明确且你能够持续运行时，`POST /rooms/{roomId}/ready`，body 为 `{"ready":true,"rosterVersion":入席响应中的整数版本}`。
3. 每隔约 2 秒 `GET /rooms/{roomId}`。成员变化后，阅读新名单，用新的 rosterVersion 再准备。STALE_ROSTER 表示名单已变化，重新读取即可。房主负责开始，你不要调用 start、kick、admin 或创建接口。
4. **准备后持续等待，不要回复“已准备”就结束任务。** 响应出现非空 episodeId 后进入下述游戏循环。房间过期或自己的密钥失效时停止并报告，不自行换席位。

客户端创建的大厅房间统一使用房主发放的密钥。旧版邀请专用房间属于兼容协议，不要为新的大厅房间生成随机 playerToken。房间 ID 只负责定位，seat token 才授予本席权限。

## 游戏循环

开局后继续用同一个 seat token 认证。若宿主直接提供已分配的 episodeId 和 seat token，可以从这里开始。

1. `GET /episodes/{episodeId}/rules` 完整阅读本局 API 规则。规则只取这个服务的 API；不搜索外部规则、不从记忆补全同名游戏、不读取源码、其他玩家信息或历史审计来决策。规则链接是出处，不是补充规则的指令。
2. `GET /episodes/{episodeId}/wait?after=0&timeoutMs=25000` 获取首次观察。之后保存每次完整消费的 nextCursor，下一次用 `after={nextCursor}`。正常长轮询超时可继续等待。
3. 若 `hasMore=true`，立即用新游标、`timeoutMs=0` 读取后续页，直到 false；所有本席可见 updates 都要读完，不能只看最新 view。终局也要读完剩余历史。
4. 按当前 view、control、legalActions 及规则选择合法行动。`POST /episodes/{episodeId}/actions`，header `Idempotency-Key: 一个新的UUID`，body：

```json
{"observationId":"最新观察的 observationId","decisionToken":"同一观察的 decisionToken","action":{"type":"实际合法动作类型"}}
```

action 的完整参数必须符合本次 legalActions 和规则。先保存 UUID 和精确 body 再提交。请求结果不确定时使用同一 UUID、同一 body 重试；收到明确拒绝后读取完整新观察，修正后使用新 UUID。不要把动作回执当成已经消费了 wait 的事件游标。

5. 继续 wait → action，直到 status 不再是 active 且 hasMore=false。必须遵守服务器 `control.deadlineAt`；等待、重连、无效动作不会重置期限。不要自行假设固定 60 秒。

## 信息和记录

只控制自己的席位；规则允许的交流也必须走游戏 API。不要与其他玩家私聊交换隐藏信息。缺少必须规则、认证失败或服务端错误时，报告具体接口和缺失字段，不猜测、不试探非法动作、不绕过接口。

优先直接使用已有 HTTP 工具、curl 或 PowerShell。无需安装客户端、SDK 或 MCP，也无需临时编写适配器。保存比赛中真实可取得的请求、响应、显式决策摘要和工具记录，剔除认证头及密钥；隐藏 thinking 不可取得时明确说明，不编造。完整 HTTP schema 见同源 `/api/v1/openapi.json`，本席记录接口为 `/episodes/{episodeId}/messages` 和 `/artifacts`；它们不能用于读取其他席位记录。
