# 已安装云端服务：访问、维护与验收

> **最新状态（2026-09-18）**：独立入口 `https://coop.neutrinophysics.cn:34935/api/v1` 已启用并设为开机启动。Windows 正常 HTTPS、个人凭证及轨迹/messages/附件列表读取通过。报销 29375、原游戏进程和其他站点配置保持不变。80 仅提供证书验证文件，但公网验证被重定向至腾讯云/DNSPod 拦截页，HTTP-01 模拟续期失败；当前证书有效至 2026-12-16。完整当前状态与维护方式见 [34935 API](cloud-api34935.md)。下文均为此前部署快照。

> **后续状态更新（2026-09-17 21:25 北京时间）**：下文是此前部署验收快照。当前 SSH 22 与 loopback 后端正常，生产 Nginx 已停止，80/443 未监听；用户确认另一个任务正在调整生产配置。本轮未启动或改写它。独立临时 HTTPS 8443、34935 健康检查均从 Windows 当前网络路径与服务器自身通过，测试资源已撤除，不能把这些端口写成长期可用入口。新版桌面客户端已准备，详见[客户端说明](desktop-client.md)和[34935 证据](../artifacts/client-port34935-check.json)。

记录日期：2026-09-17。服务已安装，入口为 [Coop Bench 审计台](https://coop.neutrinophysics.cn)，Agent API 为 `https://coop.neutrinophysics.cn/api/v1`。最新消息版本的云端正常 HTTPS 读取通过；Windows 浏览器 15:25 复验仍遇到连接关闭，不能把首次部署的浏览器通过结果当作当前客户端网络可用证明。具体证据见末尾。本页记录实际安装；可复用方案见 [云端部署](cloud-deployment.md)。

## 主机与版本

| 项目 | 本次安装 |
|---|---|
| 腾讯云产品 / 实例 | Lighthouse / `lhins-g98xlmte` |
| 地域 / 公网 IPv4 | `ap-beijing` / `62.234.160.98` |
| SSH 管理入口 | `ssh ubuntu@62.234.160.98` |
| 系统 | Ubuntu 24.04.4 LTS，x86_64 |
| Node | 24.21.0，`/opt/coop-bench-node/bin/node` |
| 发布目录 | `/opt/coop-bench/releases/0118c12eddcc/` |
| 当前版本入口 | `/opt/coop-bench/current`，指向上述发布目录 |
| 源码构建指纹 | `0118c12eddcc6b15045ddacb3d7599ecba02d79d29b0e738b3d5896080bb796d` |
| 进程 / 内部监听 | systemd `coop-bench.service`，专用非 root 用户 `coop-bench`，`127.0.0.1:8788` |
| HTTPS 代理 | 主机已有 Nginx，新增独立 `coop-bench` 站点 |

原有 Nginx `up-the-chain` 站点和主机防火墙规则保留。Windows 上的桌游服务继续仅监听本机；本地历史对局、数据库和个人密钥没有随发布包上传。已有 Windows 0.3.0 安装包未重新构建，不能把本次源码修复视为已经包含在旧安装包内。

15:24（北京时间）已升级比赛期间 messages 采集版本。升级前确认无活跃游戏并全库备份；原 2 局、42 个事件、137 份观察、42 个回放帧、3 份附件及 31 个分块逐表比较保持不变，新完整备份与实时数据库一致。新增私有消息表，无删除旧轨迹操作。[升级与保留校验](../artifacts/artifact-release/cloud-messages-upgrade.txt)

随后已发布花火通信与计分修复版本 `0118c12eddcc`，移除公共手牌重排动作，限定当前玩家只能出牌、弃牌或消耗提示标记；终局明确区分计分结束、满分与爆炸失败。升级前再次确认没有活跃游戏，全库备份后逐表核对上述历史数量与数据保持不变。[花火升级与保留校验](../artifacts/artifact-release/cloud-hanabi-upgrade.txt)

新增[消息接口与采集客户端](agent-messages.md)支持比赛时持续上传真实模型请求/响应、reasoning、usage 及工具结果；网页按玩家审阅。早期 Take Time 三子智能体演示只保存三份工具日志附件；本次花火演示已保存 372 条真实可见消息与工具记录，以及 6 个原始轨迹附件。三位玩家消息流均封存为 `partial / not-provided`：包含实际输入、回复及简短决策说明，没有取得模型内部 thinking 或供应商 token 用量，也没有合成补写这些字段。外部 reasoning 模型的实际供应商采集仍需相应 API 配置验证。

新版 [附件接口](agent-artifacts.md) 支持每位玩家终局后上传实际原始轨迹；按分块保存到同一 SQLite，验证后网页可下载。客户端提供的 reasoning 与 token 元数据保留来源标记，不冒充模型隐藏思维。所有游戏轨迹和附件不自动删除/过期，满额拒绝新写入。

## 网络、DNS 与证书

```text
同事浏览器 / Agent
  → https://coop.neutrinophysics.cn:443
  → Lighthouse 防火墙 → Nginx TLS
  → 127.0.0.1:8788 → coop-bench → 本机 SQLite
```

- DNSPod 的 `coop.neutrinophysics.cn` A 记录为 `62.234.160.98`，TTL 600；已通过服务商写后读取核对。[DNS 更新记录](../artifacts/security-2026-09-17/dns-update.json)
- 通过官方 `CreateFirewallRules` 接口仅新增 TCP 443 入站规则，防火墙版本从 1 更新为 2。已有 TCP 22、TCP 80 和 ICMP 三条规则逐项保持一致；8788 未向公网开放。[规则修改前后记录](../artifacts/cloud-deployment/cloud-https-firewall.json)
- 应用只接受实际来自 loopback 的代理连接，校验配置的精确 HTTPS 域名和浏览器 Origin，不信任请求自带的转发 IP 或身份头。动态 IP 的同事使用独立凭据登录。
- 证书到期日为 **2026-12-16**；`certbot renew --dry-run` 已成功。续期部署钩子会重新加载 Nginx。
- 原 `desktop501.neutrinophysics.cn` 的 AAAA / DDNS 用途保留，与此次云服务器 A 记录独立。

本次保留了原有 SSH 22 的公网允许规则，没有声称已经收紧管理员入口；后续修改管理入口应保留有效 SSH 会话，按实际管理网络验证。

## 五个独立账户

组织者和四位同事均为 `operator`，可以创建、中止实验和导出数据，也能查看共享实验记录。**这是共享实验工作区，没有按同事隔离数据的租户机制。** Agent 实际玩游戏时应使用该局相应玩家的 `seatToken`。

原始个人凭据保存在下面的本地 Windows 私有文件中，本文不包含凭据值。将每份文件只交给对应使用者；用户在 HTTPS 首页登录框填入凭据，Agent 使用请求头 `Authorization: Bearer <凭据>`，不要把凭据放进 URL。

本地目录：`C:\Users\xuefe\Documents\chatgpt pro deep research\coop-bench\artifacts\cloud-private`

| 使用者 | 身份 ID | 私有文件 | 角色 | 首次配置到期时间（UTC） |
|---|---|---|---|---|
| 组织者 | `owner` | `owner.txt` | operator | 2026-10-17 05:48:02.245 |
| 同事 1 | `tester-1` | `tester-1.txt` | operator | 2026-10-17 05:48:02.318 |
| 同事 2 | `tester-2` | `tester-2.txt` | operator | 2026-10-17 05:48:02.390 |
| 同事 3 | `tester-3` | `tester-3.txt` | operator | 2026-10-17 05:48:02.462 |
| 同事 4 | `tester-4` | `tester-4.txt` | operator | 2026-10-17 05:48:02.535 |

北京时间比表中时间晚 8 小时。账户初始有效期为 30 天；后续状态以服务器上的管理命令输出为准。服务器用户配置只保存令牌摘要，不保存这五份明文令牌。开启共享模式后，coordinator 主凭据无法用于 HTTP 中需要人工身份验证的接口，包括本机访问；公开健康与游戏说明接口仍可正常读取。组织者使用自己的 `owner` 身份。

## 实际文件位置

以下均为云服务器路径：

| 路径 | 用途 / 权限 |
|---|---|
| `/opt/coop-bench/current/app/src/server.mjs` | 当前应用入口；发布目录由 root 持有，应用只读 |
| `/opt/coop-bench/current/app/scripts/manage-access.mjs` | 个人凭据管理命令 |
| `/etc/systemd/system/coop-bench.service` | 服务定义 |
| `/etc/coop-bench/coop-bench.env` | 服务配置；root:root，0600 |
| `/etc/coop-bench/access-users.json` | 个人凭据摘要；root:coop-bench，0640 |
| `/var/lib/coop-bench/` | 持久化数据；coop-bench 用户，0700 |
| `/var/lib/coop-bench/episodes.sqlite` | 对局、操作、观察、注释等；运行时还可能存在 WAL / SHM 文件 |
| `/var/lib/coop-bench/security-audit.jsonl` | 脱敏安全日志，另有轮转文件 `.1`、`.2` |
| `/etc/systemd/journald@coop-bench.conf` | 独立日志 namespace 的体积和保留期限 |
| `/etc/nginx/sites-available/coop-bench` | 新增站点配置，链接到 `sites-enabled/coop-bench` |
| `/var/log/nginx/coop-bench.access.log` | 该站点访问日志 |
| `/var/log/nginx/coop-bench.error.log` | 该站点错误日志 |
| `/etc/letsencrypt/live/coop.neutrinophysics.cn/` | 证书及私钥目录；不得复制进项目或发给同事 |
| `/etc/letsencrypt/renewal-hooks/deploy/coop-bench-reload-nginx` | 证书续期后重新加载 Nginx |
| `/var/backups/coop-bench/latest.sqlite` | 最近一致性全库备份，含附件 BLOB，root 私有 |
| `/var/backups/coop-bench/previous.sqlite` | 上一次完整备份；第二次成功备份后存在 |
| `/var/backups/coop-bench/pre-artifacts-20260917/latest.sqlite` | 附件升级前的原始完整备份 |
| `/var/backups/coop-bench/pre-messages-20260917/latest.sqlite` | 消息接口升级前的完整备份，含两局与三份附件 |
| `/var/backups/coop-bench/pre-hanabi-20260917/latest.sqlite` | 花火通信与计分修复前的完整备份 |
| `/etc/systemd/system/coop-bench-backup.timer` | 已启用每日 03:30 附近的备份定时器，随机延迟最多 10 分钟 |

systemd 限制服务写入 `/var/lib/coop-bench`，启用了非 root 运行、只读系统目录、禁止提权、私有临时目录及设备限制，并设置内存、CPU、进程数与日志预算。业务内容默认每局 64 MiB、全服务 512 MiB；这些是业务写入配额，不能当作 SQLite 文件、索引和 WAL 的磁盘硬上限，仍需关注剩余空间。

## 常用维护命令

先执行 `ssh ubuntu@62.234.160.98`，以下命令在服务器运行。

### 查看状态、重启与日志

```sh
sudo systemctl status coop-bench --no-pager
curl --fail http://127.0.0.1:8788/health
ss -ltn 'sport = :8788'
sudo systemctl restart coop-bench
sudo journalctl --namespace=coop-bench -u coop-bench -n 100 --no-pager
sudo systemctl status coop-bench-backup.timer --no-pager
sudo journalctl -u coop-bench-backup.service -n 50 --no-pager
sudo tail -n 50 /var/lib/coop-bench/security-audit.jsonl
sudo tail -n 50 /var/log/nginx/coop-bench.access.log
sudo tail -n 50 /var/log/nginx/coop-bench.error.log
df -h /var/lib/coop-bench
```

### 查看账户、吊销与替换

列出账户只显示 ID、角色、禁用状态和到期时间：

```sh
sudo /opt/coop-bench-node/bin/node /opt/coop-bench/current/app/scripts/manage-access.mjs list --users-file /etc/coop-bench/access-users.json
```

例如吊销同事 2：

```sh
sudo /opt/coop-bench-node/bin/node /opt/coop-bench/current/app/scripts/manage-access.mjs revoke --users-file /etc/coop-bench/access-users.json --id tester-2
sudo chown root:coop-bench /etc/coop-bench/access-users.json
sudo chmod 0640 /etc/coop-bench/access-users.json
```

吊销对后续请求立即生效，无须重启服务。管理命令通过原子替换写入文件，默认权限为 0600；**每次修改后必须恢复上面的组和 0640 权限**，否则服务无法读取用户配置，会拒绝登录。修改服务器上的实时配置，不要用本地旧副本覆盖它。

例如创建替换身份（新 ID 和新的输出文件）：

```sh
sudo /opt/coop-bench-node/bin/node /opt/coop-bench/current/app/scripts/manage-access.mjs add --users-file /etc/coop-bench/access-users.json --id tester-2-new --role operator --expires-in-days 30 --out /root/coop-bench-credentials/tester-2-new.txt
sudo chown root:coop-bench /etc/coop-bench/access-users.json
sudo chmod 0640 /etc/coop-bench/access-users.json
```

此例会将新凭据写入服务器 root 私有目录，命令不会打印令牌；它与首次交付的 Windows 私有文件是不同位置。原 ID 仍然禁用。只需要审阅已结束对局的新增账户可使用 `--role auditor`。

### Nginx 与证书

```sh
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certificates
sudo systemctl status certbot.timer --no-pager
```

配置修改应先通过 `nginx -t`，再重新加载。证书到期或续期故障时检查域名仍指向本机、80/443 可达、续期定时任务与部署钩子状态。本次续期演练已通过，无须为查看状态重复签发证书。

备份或升级前应同时考虑数据库和实时账户配置。不要仅复制仍在写入的 SQLite 主文件而遗漏 WAL；采用 SQLite 一致性备份，或在已安排的停机窗口备份数据目录。发布目录可以替换，数据目录应保留。

## 已完成的验证与边界

| 验证 | 结果与证据 |
|---|---|
| 花火修复及轨迹审计本地完整测试 | **216/216 通过**，含花火通信、隐藏信息隔离、计分、轨迹完整覆盖和回放绑定，以及消息/附件回归；[测试输出](../artifacts/artifact-release/hanabi-final-tests.txt) |
| 花火实际 messages 与附件回读 | 372 条捕获记录逐条重组核验，6 份附件长度及 SHA-256 与原始文件一致，三席均已封存；[消息核验](../artifacts/hanabi-demo/messages-exact-verification.json)、[附件核验](../artifacts/hanabi-demo/verification.json) |
| 花火轨迹与自动训练标签 | 61 个接受动作，回放通过，23/25，归一化终局团队奖励 0.92，审阅注释已写入；[回放](../artifacts/hanabi-demo/replay.json)、[服务器回读](../artifacts/hanabi-demo/review-upload.json) |
| 云端持久化与一致性备份 | 原 2 局和 3 份附件逐行保留；新花火 6 份附件、372 条消息、3 份封存记录及审阅注释均入库；在线全库备份与实时库逐表一致，SQLite 完整性检查通过；[备份核验](../artifacts/hanabi-demo/backup-verification.json) |
| 当前前端隔离测试 | **29 项消息验证 + 21 项附件回归通过**，均为明确标注的本地合成数据；[消息结果](../artifacts/model-messages-ui-smoke/result.json) |
| 当前云端正常 HTTPS 读取 | owner 读取身份、三玩家消息摘要、分页、三份旧附件和新版 HTML 均成功；请求从服务器经公开域名发出；[结果](../artifacts/artifact-release/cloud-messages-api.json) |
| 最新 Windows HTTPS 浏览器 | **未通过**，15:25 的一次复验 ERR_CONNECTION_CLOSED；本机 curl/Node 也曾连接失败，服务器自身域名读取正常，疑似客户端 DNS/TUN 或链路问题，未确定具体原因、未改代理设置；[结果](../artifacts/artifact-release/cloud-browser-result.json) |
| 云端 API 功能 / 有限权限检查 | **20/20 通过**，通过临时 SSH 本地转发连接远端 loopback；[完整记录](../artifacts/security-2026-09-17/cloud-api-validation.json) |
| 首次部署的公网正常 HTTPS 浏览器 | **当时 5/5 通过**，2026-09-17 06:18:17 UTC：证书校验、owner 登录、存储轨迹显示、渲染器无 Node 访问、退出清空页面与凭据；[历史结果](../artifacts/security-2026-09-17/cloud-browser-result.json) |
| 浏览器画面 | 展示 Take Time 云端对局的 17 帧，截图已目视检查；[审计台截图](../artifacts/security-2026-09-17/cloud-audit.png) |
| 证书续期 | `certbot renew --dry-run` 成功，续期定时器 active；[原始结果](../artifacts/cloud-deployment/certificate-renewal-result.json)。演练验证模拟签发，未证明部署钩子实际执行；钩子配置及 `nginx -t` 已单独检查 |

云端示范局 `71a3d7ec-0e9d-4f1a-b821-ebf2ae98de6b` 使用“选择第一个合法动作”的机械脚本，包含 15 个接受动作、17 个事件，最终失败，重放校验通过。这证明部署、持久化和审计路径工作，**不是 LLM 玩游戏的评估，也不是 SFT 专家示范数据**；不能据此评价模型能力。

后续三子智能体实际演示局 `9a40164c-3d95-4c79-9288-d8f62ec74f20` 有 4 次公开讨论、3 次看牌和 12 次放牌，胜利，分区总和为 3≤3≤5≤10≤20≤29。使用了 3 次可选明置，不能称全暗置获胜。三份附件 SHA-256 与原始工具日志一致；它们没有完整模型 messages 或内部 thinking。[逐玩家审计](cloud-agent-demo-audit.md)

新花火三子智能体实局 [`5286719d-dcf7-48d1-81e8-2c1d2ba5c639`](https://coop.neutrinophysics.cn/#episode=5286719d-dcf7-48d1-81e8-2c1d2ba5c639) 使用服务器随机发牌，三席独立上下文，仅通过合法提示交流，按同一局持续完成，没有选择种子或重开。自动得分 **23/25**，61 个有效动作、0 次 API 拒绝、1 次出牌错误。17 次出牌可由可见硬约束保证安全，其余 7 次带风险，其中 6 次成功。黄 5 于第 13 回合丢失，最后一张黄 4 于第 25 回合丢失，团队最终达到剩余牌张所允许的 23 分上限。详见[独立审计](hanabi-agent-demo-review.md)。上述未作弊结论仅限已捕获记录，不证明不存在记录外工具或交流。

本次攻击样例在隔离的本机随机 loopback 端口、测试令牌和测试数据库上执行。另行提出的公网攻击子任务被平台网络安全风控拦截，**没有执行**；这既不是网站抵御攻击的结果，也不能称为已完成公网渗透测试。已完成的公网 TLS / 登录验收属于正常访问。具体复现、修复与未覆盖项见 [安全审计](security-audit.md)。

以上状态为本次安装验收快照，不代表持续监控或不存在其他漏洞。后续代码、依赖、代理或权限配置变更后，应重新完成对应验证。
