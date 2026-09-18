# 人工账号密码与会话

账号密码只服务于人工桌面客户端和审计界面。身份继续来自现有 `access-users.json`，角色仍是 `operator` 或 `auditor`。Agent 继续使用每局单独的座位凭证。

## 首次设置与日常登录

1. 管理员通过现有管理工具创建个人账号，单独交付该账号的个人 API 凭证。
2. 用户先用自己的个人凭证连接，在设置中输入自己的新密码。
3. 此后使用账号 ID 和密码登录。桌面主进程保存服务端返回的短期会话；勾选记住登录时，使用系统安全存储加密保存会话，不保存密码。
4. 修改已设置的密码必须提供当前密码。成功后所有旧人工会话失效，调用方获得一个新会话。

没有匿名注册或“第一个访问者成为管理员”的入口。仅配置了共享 HTTPS 来源、有效账号文件的服务启用密码功能；纯本机版仍使用原有本机凭证。

新密码长度为 **12–128 个 Unicode 码点，UTF-8 最多 512 字节**。密码不去除首尾空白、不做 Unicode 规范化；不接受全空白密码或不完整的 Unicode 代理项。登录及校验当前密码允许 1–128 个码点，错误密码统一按认证失败处理。

## API

所有路径以 `/api/v1` 开头。POST 使用 `Content-Type: application/json`；私有接口使用 `Authorization: Bearer ...`。仅通过 HTTPS 代理或本机回环访问，不采用 Cookie 或宽泛 CORS。

| 方法和路径 | 认证 | 请求与响应 |
| --- | --- | --- |
| `GET /auth/status` | 公开 | `{enabled,passwordLoginAvailable,sessionTtlSeconds,passwordPolicy}`；不返回账号名单或某账号是否已设密码 |
| `POST /auth/login` | 公开 | 输入 `{userId,password}`，返回下方会话结果 |
| `GET /auth/account` | 个人凭证或人工会话 | `{userId,role,passwordConfigured,authentication,sessionExpiresAt?}`；`authentication` 为 `personal-token` 或 `password-session` |
| `POST /auth/password` | 首次仅个人凭证；后续也可用人工会话 | 输入 `{password,currentPassword?}`；已设密码时必须提供 `currentPassword`；返回新会话结果 |
| `POST /auth/logout` | 个人凭证或人工会话 | 输入 `{}`，返回 `{loggedOut:true}`；仅撤销本次人工会话，原个人凭证保持可用 |

登录和设密码成功结果：

```json
{
  "token": "hs1_<仅在成功响应中交付的随机会话凭证>",
  "expiresAt": "<ISO 8601 UTC 时间>",
  "identity": { "id": "<个人账号 ID>", "role": "operator" },
  "passwordConfigured": true
}
```

桌面通用请求桥接不开放返回会话的认证接口。主进程专用登录/改密方法消费这些结果，仅向界面返回安全的身份和连接信息。

错误使用现有 `{error:{code,message}}` 结构，消息不包含输入密码、会话或账号是否存在。未知账号、未设置密码、密码错误、账号禁用和账号到期的有效登录请求，均返回相同的 `401 UNAUTHORIZED`。错误输入返回 `400 INVALID_REQUEST`，请求体超过 64 KiB 返回 `413 TOO_LARGE`，限流返回 `429 RATE_LIMITED`。并发修改冲突返回 `409 AUTH_CONFLICT`。未启用密码认证返回 `403 FORBIDDEN`。

## 保存、撤销与故障边界

- `startLocalApp` 在服务数据目录单独创建 `human-auth.sqlite`。不向对局数据库添加认证表，不变更 Agent 权限。该文件包含身份绑定、随机盐、密码哈希及会话哈希，需要按私有配置同等保护和备份。
- 服务备份工具同时把该文件保存到独立 `human-auth` 子目录，采用 SQLite 一致性备份和 `0600` 权限。恢复旧认证备份可能恢复已经撤销的会话及旧密码状态；恢复时应清除所有恢复出的人工会话，必要时轮换个人凭证并让用户重新设置密码。不要把认证备份并入可供审计者下载的游戏附件。
- 密码使用 Node 内置异步 scrypt，参数版本 1：`N=65536, r=8, p=2`，随机 16 字节盐，64 字节派生值。此参数组合属于 OWASP 列出的 scrypt 配置；每次验证约使用 64 MiB KDF 内存。[OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)
- 最多同时运行 2 个 KDF 作业，最多排队 4 个；其余立即限流。全局认证突发 12 次、持续 30 次/分钟；每个账号键突发 5 次、持续 10 次/分钟。账号是否存在均执行同样的 KDF。Node 的 scrypt 使用异步回调，不在事件循环同步计算密码。[Node scrypt 文档](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- 人工会话由 256 位随机数生成，数据库只保存其 SHA-256 摘要。最长有效期 7 天，若账号先到期则同步提前到期。每个账号最多保留 8 个会话；超过时删除最旧会话。重启可恢复未撤销的有效会话。
- 每次会话请求重新读取当前账号角色、禁用和到期配置；不存在或已禁用的账号立即失去权限。人工会话不能充当玩家座位凭证。
- 密码记录和会话绑定当前个人凭证摘要。**管理员轮换个人凭证，会同时使旧密码登记和会话失效**；用户须用新个人凭证重新设置密码。删除再创建同名账号时应生成新个人凭证，不复用旧凭证。
- 密码验证在事务外异步进行；写入前重新检查调用者及密码记录版本。并发首次设置只有一个请求成功；旧密码的延迟验证不能在改密后签发新会话。
- 退出只撤销当前人工会话。若网络断开，本地客户端仍应先清除本机保存的信息，并说明服务端撤销未确认；其余服务端会话最多保留到有效期结束。
- 登录或修改密码响应丢失时，服务端可能已经提交。不要自动重试修改密码；使用新密码重新登录确认。记录和审计日志不保存密码或会话明文。
- 本地 Unix 数据库文件权限为 `0600`；Windows 继承应用数据目录的用户访问控制。数据库损坏、账号配置无效或未知参数版本均拒绝认证，不退回未认证模式。
- 服务关闭先停止 HTTP 连接，再排空有界 KDF 作业，最后关闭认证和游戏数据库；关闭期间未完成的改密不会继续写入已关闭数据库。

## 部署集成

`createApi(...,{humanAuth})` 支持注入隔离认证实例，便于测试；注入者负责调用 `HumanAuth.close()`。`startLocalApp` 则拥有实例并自动关闭。纯本机/没有配置认证的测试不需要认证数据库。

代理的 API 白名单需要放行公开 `GET /api/v1/auth/status`、`POST /api/v1/auth/login`，及私有 `GET /api/v1/auth/account`、`POST /api/v1/auth/password`、`POST /api/v1/auth/logout`。保留原有 HTTPS、Origin、Host、请求体和速率限制；不要增加匿名初始化或 Basic Auth 替代 Bearer。

生产首次密码由用户本人输入。部署或测试脚本不得为真实账号生成默认密码，也不应把密码写入命令行、环境文件、审计附件或仓库。

## 验证

`node --test test/human-auth.test.ts` 使用独立临时数据库和合成凭证验证：初始化权限、统一登录错误、真实 scrypt 和摘要存储、重启、到期、角色修改、禁用和账号轮换、改密与退出、并发设置、请求大小/Origin、限流/队列、Agent 信息隔离及本机兼容。
