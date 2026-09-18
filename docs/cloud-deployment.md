# 腾讯云部署方案：独立 Linux 服务

状态（2026-09-17）：已安装到北京地域腾讯云 Lighthouse `lhins-g98xlmte`（`62.234.160.98`），复用 Ubuntu 24.04.4 上的 Nginx，保留已有站点。正式测试入口为 **https://coop.neutrinophysics.cn**，DNS、证书、443 入站和正常浏览器登录/轨迹显示均已验证。以下是可复用的部署流程；实际目录、维护命令与验收边界见 [本次安装记录](cloud-installed.md)。Windows 服务仍仅监听本机，`desktop501` 的 DDNS 用途保留。

## 结构

```text
同事浏览器 / Agent
       │ HTTPS + 每人独立凭据
       ▼
腾讯云 Lighthouse 防火墙：HTTPS 443；证书验证/跳转使用 HTTP 80
       ▼
Nginx：TLS、Host/SNI 校验、超时、请求体限制、日志轮转
       │ 127.0.0.1:8788
       ▼
systemd → 非 root 的 coop-bench 用户 → Node → SQLite
```

同事使用动态 IP，因此应用访问依靠独立身份凭据和 HTTPS。SSH 管理端口另行收紧到管理员当前 IP 或已有管理网络；应用的 8788 和 Caddy 的管理端口 2019 都不应出现在公网安全组中。HTTP API 不信任客户端提供的转发 IP 头。

此主机优先复用现有 Nginx。以下 Caddy 模板只适用于没有既有代理的独立主机，不在本机安装第二个占用 80/443 的代理。Nginx 上游使用同机 loopback HTTP，显式传递已校验的 Host，并删除转发身份头。[Nginx 代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

## 发布包

本地先完成测试，再构建运行时与发布包：

```text
node --test test/*.test.ts experiments/*.test.ts
node scripts/build.mjs
node scripts/package-cloud.mjs
```

打包脚本要求运行时指纹与当前源代码一致。它只复制明确列举的服务器 bundle、六个前端文件、管理命令、部署模板和本文；生成逐文件 SHA-256 清单，并检查压缩包文件列表。

不打包 `data/`、rollout、历史实验、任何 env、Windows 私钥或 token。**Linux Node 二进制也不在包中**：需按服务器 CPU 架构安装官方对应版本并校验官方摘要。本地安全测试使用 Node 24.21.0；云端应采用核实过安全更新的 Node 24.x，安装到 `/opt/coop-bench-node/bin/node`。包内不依赖运行时 `node_modules` 或 Electron。

## 远端预检查

取得 SSH 信息后，先只读检查：

- SSH 主机密钥指纹、身份、`sudo` 权限。
- Linux 发行版、CPU 架构、systemd 版本、可用内存与磁盘。
- 已有站点、Caddy/Nginx、80/443/8788 监听和证书配置。
- 腾讯云安全组、主机防火墙、域名解析；确认管理员连接不会被新规则切断。
- 软件安装渠道和现有 Node/Caddy 版本。模板需要现代 systemd 的日志 namespace；使用实际机器的 `systemd-analyze verify` 验证兼容性。

不能直接用模板覆盖已有反向代理配置。安装操作必须按已确认的发行版执行；本文不提供未经核实的“一键安装”命令。

## 目录和权限

| 路径 | 所有者与用途 |
|---|---|
| `/opt/coop-bench/releases/<release-id>/` | root 所有、应用只读的发布包 |
| `/opt/coop-bench/current` | 指向已验证发布版本 |
| `/opt/coop-bench-node/` | root 所有、应用只读的 Node 24.x |
| `/etc/coop-bench/coop-bench.env` | root:root 0600；域名和目录配置，不放 token |
| `/etc/coop-bench/access-users.json` | root:coop-bench 0640；个人凭据摘要 |
| `/var/lib/coop-bench/` | coop-bench 用户 0700；SQLite、应用安全日志 |
| `/root/coop-bench-credentials/` | root 私有；首次生成、分别交付的用户凭据 |

创建专用系统用户 `coop-bench`，无交互登录 shell。不要让该用户成为 sudo、docker 或其他管理组成员。应用数据与发布目录分离；升级不覆盖 SQLite。

## 配置和独立身份

1. 将模板 `deploy/coop-bench.env.example` 安装为 `/etc/coop-bench/coop-bench.env`，填写最终真实域名。`COOP_TRUSTED_PROXY_ORIGIN` 必须是精确、全小写、无尾斜线和端口的 `https://域名`。
2. 将 `deploy/coop-bench.service` 安装到 `/etc/systemd/system/coop-bench.service`。
3. 将 `deploy/journald-coop-bench.conf` 安装到 `/etc/systemd/journald@coop-bench.conf`，用于该服务自己的日志 namespace。
4. 在服务器本地为组织者和四位同事创建独立凭据。运行下面的管理命令需要 root，以写入受保护的配置与凭据目录。

```text
/opt/coop-bench-node/bin/node /opt/coop-bench/current/app/scripts/manage-access.mjs add --users-file /etc/coop-bench/access-users.json --id owner --role operator --out /root/coop-bench-credentials/owner.txt
/opt/coop-bench-node/bin/node /opt/coop-bench/current/app/scripts/manage-access.mjs add --users-file /etc/coop-bench/access-users.json --id tester-a --role auditor --out /root/coop-bench-credentials/tester-a.txt
```

按需要重复创建其他同事。auditor 可审计已结束游戏；operator 可创建、中止游戏和导出数据。普通 agent 仅获得对应游戏的 seat token。开启共享后 coordinator 主凭据对整个 HTTP 服务禁用，主机所有者也使用自己的 operator。

每次管理命令原子更新用户配置后，都将配置恢复为 `root:coop-bench`、`0640`；否则命令默认生成的 `0600` 会使服务无法读取，并拒绝个人登录。

```text
chown root:coop-bench /etc/coop-bench/access-users.json
chmod 0640 /etc/coop-bench/access-users.json
```

吊销使用 `revoke --users-file /etc/coop-bench/access-users.json --id tester-a`，随后同样恢复组与权限。默认凭据有效期 30 天，逐人分发，禁止把凭据放在 URL、日志或训练样本里。

## HTTPS 与服务启动前验证

### 本次服务器：保留 Nginx，新增单独站点

1. 域名确认后先检查 DNS 指向云主机；不会自动改动 `desktop501.neutrinophysics.cn` 的本机 DDNS 用途。
2. 将 `deploy/nginx-coop-bench-http.conf.example` 作为新的虚拟主机加入，保留已有配置。建立 `/var/lib/letsencrypt/.well-known/acme-challenge/`，仅用于证书验证。`nginx -t` 成功后 reload。
3. 使用 Certbot 的 webroot 模式获取证书，例如 `certbot certonly --webroot -w /var/lib/letsencrypt -d <已批准的真实域名>`。需先确认账号、ACME 联系邮箱及条款；安装渠道按已验证的 Ubuntu 环境选择。此模式通过现有 Nginx 提供挑战文件，不停用现有站点。[Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html)
4. 证书成功后，将这一新增站点换成 `deploy/nginx-coop-bench.conf.example` 的已填实版本。修改所有域名和证书路径，与应用 `COOP_TRUSTED_PROXY_ORIGIN` 一致。先 `nginx -t`，再 reload；验证其他已有站点仍正常。
5. 设置自动续期与成功续期后 reload Nginx 的部署钩子，运行 renew dry-run 验证。SSH-only 阶段不执行这些 DNS/证书/公网入口步骤。

模板的 64 KiB body 限制和请求超时可减少慢请求占用；每个真实连接 IP 每秒 10 次请求、短时 burst 30、并发连接 20，适合初期四人测试，真实负载超出后按证据调整。没有配置可信前置代理，不从客户端 X-Forwarded-For 取限流身份。[请求限制与超时](https://nginx.org/en/docs/http/ngx_http_core_module.html)

Nginx access log 只包含时间、实际连接 IP、状态、字节数和耗时，不包含 URI、请求头或 body。error log 仍可能记录错误请求的 URI，凭据必须只放在 Authorization header 中。检查系统现有 `/etc/logrotate.d/nginx` 是否已经匹配新增日志；不要重复添加同一路径的 logrotate stanza。若未覆盖，再按 `deploy/logrotate-nginx-coop-bench.example` 配置轮转。logrotate 是周期检查，`maxsize` 不是实时硬磁盘上限，应配合磁盘监控。

### 仅供新主机选择的 Caddy 分支

根据实际主机情况合并 `deploy/Caddyfile.example`，把其中域名改为与应用配置完全相同的真实名称。Caddy 的 access log 删除请求头、URI 和响应头；应用安全日志记录规范化 endpoint、身份和状态码。Caddy 日志每份约 10 MiB，最多保留三个旧文件。[日志过滤和轮转](https://caddyserver.com/docs/caddyfile/directives/log)

模板还设置请求头/请求体超时和 64 KiB body 上限，配合应用自身的配额与校验；它不能替代云平台的网络洪泛防护。[请求超时](https://caddyserver.com/docs/caddyfile/options)、[请求体限制](https://caddyserver.com/docs/caddyfile/directives/request_body)

先在实际 Linux 上验证：

```text
systemd-analyze verify /etc/systemd/system/coop-bench.service
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

服务 unit 使用专用身份、只读系统目录、私有临时目录、能力清空、禁止提权和资源限制。`MemoryDenyWriteExecute` 未启用，因为 Node 的 V8 JIT 需要可执行内存；不可为了安全评分盲目追加会破坏运行的开关。需在目标系统上检查实际生效的沙箱能力。[systemd 官方执行环境文档](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml)

应用独立 journal 上限 100 MiB，安全审计 JSONL 保留当前及两个旧文件，每份约 1 MiB。SQLite 仍是有状态资料，需要磁盘监控、备份与保留期限；日志限额不等于数据库磁盘配额。初始内存上限 768 MiB、单核 CPU 配额是四人测试的可调起点，必须按真实负载验证。

模板验证通过、凭据创建完毕、DNS 和安全组复核后，再启用选定反向代理站点并进行真实 HTTPS 验收。模板存在不代表这些动作已经完成。

域名确定前，可先保持云主机上的 Node 仅监听 loopback，并通过 SSH 隧道验收页面和 API：在客户端建立 `ssh -L 8789:127.0.0.1:8788 ubuntu@62.234.160.98` 后，HTTP Host 仍需是上游服务认可的 `localhost:8788`。最简单的是用本地同端口转发、换另一台测试机或先停止占用该端口的本地实例；不要为了隧道随意放宽 Host 校验。另一种做法是直接在 SSH 远端执行 API 测试。隧道测试不需要公网开放 8788，也不代表已验证公网 HTTPS。

## 验收、升级与回退

- 检查 `ss -ltnp`：8788 只出现在 loopback，公网只有预期的 HTTPS/证书端口和受控 SSH。
- 从测试者网络访问 HTTPS，验证证书、独立身份、auditor 越权拒绝、seat 隔离、错误 Host/Origin、吊销效果和限流响应。
- 验证未认证的 `/api/v1/rollouts` 返回 401；代理伪造 localhost Host 也不能启用 coordinator。
- 运行一局游戏并审计；重启服务后 rollout 仍能读到。查看 journal 和安全日志，确认没有 token 或请求体。
- 升级前停止创建新局，结束或截断活动局，制作 SQLite 一致性备份；不要仅复制正在 WAL 模式运行的主 `.sqlite` 文件。可停服务后备份完整数据目录，或使用 SQLite backup/VACUUM INTO。
- 保留上一版目录和升级前数据快照。代码版本影响活动局的引擎指纹；升级前完成活动局。回退时先停服务，按版本兼容性选择旧代码与一致数据快照，不能假定新数据库总能被旧代码读取。

交付包和模板验证不代表完成云端部署。最终报告应补上真实服务器 OS/架构、部署版本、域名、证书、监听/安全组证据和跨网络验收结果。
