# 云端 0.9：新旧服务并行运行

2026-09-20：PostgreSQL 版已在腾讯云原主机上以独立端口、进程和数据库部署。**旧服务继续提供给正在测试的合作者；没有将旧入口切换到新后端。**

## 两个入口

| 用途 | API 地址 | 后端与数据 |
| --- | --- | --- |
| 原有测试、历史回放 | `https://coop.neutrinophysics.cn:34935/api/v1` | 原 SQLite 服务与原轨迹 |
| 0.9 新房间、长轮询、MCP 席位协议 | `https://coop.neutrinophysics.cn:34936/api/v1` | 独立 PostgreSQL 服务与新轨迹 |

两个入口不共享对局。部署时旧服务的 **8 局历史记录仍留在旧服务**；它们没有迁移、删除或复制为新库中的对局。旧对局 ID、席位令牌、邀请和登录会话不能拿到新地址继续原来的游戏。正在进行的实验应继续使用原地址，新的实验再选择新地址。

这次没有改桌面客户端的默认地址，也没有自动修改已保存的连接配置。API 根地址只提供接口，不是可浏览的管理网页；管理端和 Player 的界面随客户端安装。

## 客户端如何选择新版

1. 使用 0.9.0 管理端，在**设置 → 后端 API 地址**填写 `https://coop.neutrinophysics.cn:34936/api/v1`。
2. 保存并重新连接，用 `owner` 或自己的账户重新登录；旧地址的登录会话不迁移。
3. 确认连接状态后创建新房间，再把新房间的邀请交给参赛者。
4. Player 使用这份新邀请；MCP 配置的 `apiUrl` 也必须是新地址。参见 [MCP 接入](mcp-player.md)。

查看老实验时，在管理端设置中换回 `34935`，重新连接和登录即可。不要因为新服务中没有老对局而重新导入、覆盖或删除旧库。

## 账户与密码

新库初始化时一次性复制了原服务的 **5 个账户策略记录**，包括个人令牌摘要、角色、禁用状态和到期时间；已有 `owner` 密码的盐和验证摘要也按原值复制。服务器没有解密或取得密码明文。原个人令牌仍可用于对应的新账户，原 `owner` 密码可用于新地址登录；原登录会话没有复制，必须重新登录。

**复制后两边独立管理。** 在一边改密码、禁用账户或延期，不会自动同步另一边。已有账户到期时间不会因为复制而重新计算。需要同时吊销一个人的访问时，管理员应分别处理两个服务。

账户记录、密码验证摘要及会话留在服务器各自的持久化存储中；数据库密码和服务端配置保存在 root 私有环境文件中，没有写入仓库或安装包。参赛 Agent 使用新对局的独立席位令牌，不使用 `owner` 的审计权限。

## 网络与进程隔离

```text
旧客户端 / 正在测试的 Agent
  → HTTPS 34935 → 原代理 → 127.0.0.1:8788 → 原 SQLite

0.9 管理端 / Player / Agent
  → HTTPS 34936 → 新独立代理 → 127.0.0.1:8789 → PostgreSQL 16.15
                                                        127.0.0.1:5432
```

腾讯云 Lighthouse 防火墙仅新增 TCP `34936` 入站规则，保留旧规则。Node 和 PostgreSQL 仍只在本机提供服务，没有向公网放行 `8789` 或 `5432`。新代理严格检查公开 Host 和 TLS SNI，拒绝浏览器 Origin，限制 API 路由、请求大小及连接数量；长轮询与 SSE 使用适合的超时和无缓冲转发。

新代理只监听 `34936`，不占用 `80` 或 `443`，不依赖修改全局 Nginx 配置。对后端发送固定的内部 Host `coop.neutrinophysics.cn`，与已有的端口无关的可信代理校验相符；外部的 `:34936` 已在代理入口单独校验。

| 路径或服务 | 用途 |
| --- | --- |
| `coop-bench.service`、`coop-bench-api-proxy.service` | 原服务，保持运行 |
| `coop-bench-v09.service` | 新 PostgreSQL API，用户 `coop-bench-v09` |
| `coop-bench-v09-proxy.service` | 新独立 HTTPS 代理 |
| `/opt/coop-bench-v09/releases/`、`/opt/coop-bench-v09/current` | 新发布目录与入口 |
| `/opt/coop-bench-node/bin/node` | 只读复用已安装的 Node 24.21.0 |
| `/etc/coop-bench-v09/server.env` | 新服务私有环境配置，root 可读 |
| `/etc/coop-bench-v09/access-users.json` | 初次启动的账户摘要快照；之后由 PostgreSQL 管理账户 |
| `/etc/coop-bench-v09/api-proxy.conf` | 新代理配置 |
| `/var/lib/coop-bench-v09/` | 新服务专用状态目录；游戏数据实际在 PostgreSQL |
| PostgreSQL 数据库 `coop_bench_v09` | 新对局、观察、动作、房间、账户、messages 和附件 |
| `/var/backups/coop-bench-v09/` | 新库的完整备份 |
| `coop-bench-v09-backup.service`、`.timer` | 新库每日备份，独立于旧 SQLite 备份任务 |

新服务启动时不会读取或写入旧游戏数据库。新版本的游戏状态、接受动作和回执使用同一 PostgreSQL 事务保存；具体约束见 [服务设计](stateless-server.md)。

## 本次验收证据

- Windows 普通公网 HTTPS 路径同时读到新旧健康接口，均验证证书；新版构建 `df1cf9a3efa3…`，旧版保持 `0286cbc0bbd2…`。
- 新服务 **90 项功能检查通过**：桌面网络层 owner 登录、规则、邀请加入、准备与房主权限、暗牌隔离、SSE、持续 32.5 秒的长轮询、幂等动作、自动终局和计分、三席位消息及附件原字节、重放校验、真实 60 秒空闲超时。
- **21 项访问边界检查通过**：匿名私有读取/写入拒绝、伪造转发身份拒绝、Host/Origin 检查、路径白名单和 64 KiB 请求上限。它们是有界部署验收，不等同于全面渗透测试或容量压测。
- 新数据库完整备份恢复到独立临时库，**13 张表的行数和数据摘要全部一致**，覆盖房间、观察、事件、messages、附件分块和账号；临时恢复库随后删除。没有向在线新库或旧库做恢复。
- 新服务、代理与每日备份 timer 已设为开机启用。旧游戏、旧代理及报销代理 PID/启动时间均未变；旧配置摘要一致，旧库仍为 8 局、418 条 messages、9 份附件。

验收新建的 6 局均属于确定性部署测试，**没有调用 LLM**，不是模型成绩。包含超时测试，以及两次因验收脚本断言错误而提前结束的测试：一次错误地按 JSON 键顺序比较回执，一次把他人附件防枚举的 404 预期成 403。脚本修正后完整检查通过；先前轨迹仍保留。最终完整样例 `af20e2ff-e853-48df-a6f2-0ae927ec1f5e` 保存三席位原始工具日志与 3 份字节校验通过的附件，不补造 reasoning。

原始报告位于本机忽略目录 `artifacts/cloud-v09/`：`public-acceptance.json`、`access-boundaries.json`、`backup-restore.json`、`firewall-apply.json`、`before.json`、`after.json`。真实凭证和账号校验记录不提交 Git。端口规则通过腾讯云官方 [CreateFirewallRules](https://cloud.tencent.com/document/api/1207/48254) 增量添加，备份使用 PostgreSQL [pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)。

## 运维与备份

通过 `ssh ubuntu@62.234.160.98` 登录后：

```sh
sudo systemctl status coop-bench-v09 coop-bench-v09-proxy --no-pager
curl --fail http://127.0.0.1:8789/api/v1/health
curl --fail https://coop.neutrinophysics.cn:34936/api/v1/health
sudo journalctl -u coop-bench-v09 -n 50 --no-pager
sudo journalctl -u coop-bench-v09-proxy -n 50 --no-pager
sudo nginx -t -c /etc/coop-bench-v09/api-proxy.conf
sudo systemctl status coop-bench-v09-backup.timer --no-pager
```

手动触发新库备份：

```sh
sudo systemctl start coop-bench-v09-backup.service
sudo journalctl -u coop-bench-v09-backup.service -n 30 --no-pager
df -h /var/lib/postgresql /var/backups/coop-bench-v09
```

备份任务使用本机 Unix socket 身份验证执行 `pg_dump`，完整包含游戏、轨迹、附件和认证表。备份以时间戳保存，不自动清理；任务先完成临时文件并检查归档目录，再发布备份文件及 SHA-256。归档目录检查不等于恢复测试，恢复验收应在单独的临时数据库进行，不能对测试者使用的新库运行破坏性恢复命令。

历史轨迹不自动过期；容量不足时拒绝新写入。应监控数据库、WAL 和备份占用，并把备份另外保存到其他主机或存储；同机备份不能应对整机或磁盘损坏。旧服务继续使用原有 SQLite 备份定时器。

## 仅撤回新服务

若新服务发生问题，可只停止新增的两个进程：

```sh
sudo systemctl stop coop-bench-v09-proxy.service coop-bench-v09.service
```

这不会停止原 `coop-bench.service` 或原 `coop-bench-api-proxy.service`，也不会删除任一数据库。新库和备份保留，客户端可手动回到 `34935` 查看原实验；**新库创建的游戏不能靠切换地址在旧库续玩。** 排除故障后再启动新的两个 unit。

## TLS 与已知限制

新代理只读复用 `coop.neutrinophysics.cn` 的已有证书，当前记录的到期日是 **2026-12-16**。原服务的 HTTP-01 验证仍存在公网被重定向至腾讯云/DNSPod 拦截页的问题；开放 `34936` 没有解决备案或自动续期问题，也不能将 API 可访问表述为备案已完成。

新增证书续期部署钩子仅重载新代理，保留旧钩子。**重载钩子存在不代表续期成功。** 到期前仍需解决 HTTP-01 验证路径，或另行配置有明确凭据权限范围的 DNS-01 方案。详细历史见 [旧 34935 入口记录](cloud-api34935.md)。
