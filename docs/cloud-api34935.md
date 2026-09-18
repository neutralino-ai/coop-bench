# 已启用的桌游 API：34935

2026-09-18 已部署并启用独立 HTTPS API 服务，供 Windows/macOS 桌面客户端与各地 Agent 使用：

```text
https://coop.neutrinophysics.cn:34935/api/v1
```

Windows 正常域名路径的 TLS、owner 身份、10 个游戏、已有对局、比赛 messages 和附件列表读取均通过；无需 SSH 隧道或关闭证书校验。36 项实际端点检查通过，包括匿名/错误凭证拒绝、伪造转发头拒绝、网页与非标准路径拒绝、请求大小限制。测试未创建任何对局，前后仍为 3 局。[公网检查记录](../artifacts/cloud-api34935-validation.json)

这证明本机当前网络可以使用该入口，不代表所有同事的网络都已验证，也不等于备案已完成。

随后直接加载 0.4.1 安装包里的 RemoteSession、preload 与界面，用真实 Electron 网络栈完成 14 项只读检查：8 次 GET 全部 200，界面显示 owner/operator 绿灯、10 个游戏、花火 23 分轨迹、6 份附件与比赛消息。未打开用户窗口、未保存凭证、未修改任何对局。[真实客户端报告](../artifacts/cloud-api34935-desktop-live-check/report.json)、[绿灯截图](../artifacts/cloud-api34935-desktop-live-check/connected.png)。

## 客户端与凭证

当前 Windows 用户配置中原来的 443 地址已改为上述 34935 地址，并保留了原配置备份。修改前确认没有保存的加密凭证，未读取、转换或写入凭证。若客户端正在运行，退出并重新启动，使用原来的个人 API 凭证连接。也可在现有窗口直接修改 API 地址后连接。[地址修改记录](../artifacts/cloud-api34935-client-address.json)

0.4.1 安装包内的默认值仍是不带端口的旧地址；新设备首次安装时需填写上面的新地址。Agent 使用同一 `baseUrl`，以及组织者发给它的独立 `episodeId` 和 `seatToken`。人工审计凭证不要交给玩家 Agent。

入口只提供 API，根路径与网页静态文件返回 404。桌面客户端已包含界面；无需用浏览器打开 API 根地址。原凭证、权限与有效期保持不变。

## 服务与安全边界

```text
桌面客户端 / Agent
  → TCP 34935（腾讯云防火墙 IPv4 入站放行）
  → 独立 Nginx：TLS + 路由白名单 + 限速 / 请求大小限制
  → 127.0.0.1:8788：原游戏 API + Bearer 鉴权 + SQLite
```

| 云端位置 | 职责 |
|---|---|
| `coop-bench-api-proxy.service` | 已启用、运行中，开机启动；只管理新增代理 |
| `/etc/coop-bench/api-proxy.conf` | 独立 Nginx 配置；34935 API 与 80 ACME 验证文件 |
| `/run/coop-bench-api-proxy/` | 独立 PID 和缓冲目录 |
| `/etc/letsencrypt/renewal-hooks/deploy/coop-bench-api-proxy` | 成功续期后只重载新代理 |
| journald 标识 `coop_bench_api_proxy` | 脱敏访问日志；不记录请求正文、URL、查询串或凭证 |

公网 Host 和 TLS SNI 必须匹配，方法和路径必须在明确的 API 白名单内。原始路径另行检查，拒绝编码路径、重复斜杠、别名及静态网页。POST 最大 64 KiB，附件使用已有分块接口；不自动重试写请求。代理不设置 Basic Auth，访问权限继续由后端 Bearer 凭证验证。

旧后端的代理配置只接受无端口域名，因此独立入口检查外部 Host 后，向后端发送固定的内部 Host `coop.neutrinophysics.cn`。任何非空 `Origin` 都在入口被拒绝；此入口支持原生客户端和 Agent，不提供浏览器跨域调用。未通过清空任意 Origin 来绕过既有检查。

部署只新增独立配置、systemd unit 与证书重载钩子。全局 Nginx 配置、报销 29375 的配置哈希及进程、游戏引擎进程均保持不变。云端仍使用构建 `0118c12eddcc6b15045ddacb3d7599ecba02d79d29b0e738b3d5896080bb796d`，没有数据库迁移或游戏版本升级。[安装与保留核对](../artifacts/cloud-api34935-installation.json)

## 证书：当前有效，HTTP-01 续期仍受阻

当前证书有效至 **2026-12-16**。新增的 80 监听只服务 `/.well-known/acme-challenge/` 下的验证文件，其他路径不代理到游戏服务。独立代理的重载、worker 轮换和新增证书重载钩子已验证成功。

**模拟续期没有通过。** 公共 DNS A 记录仍正确指向 `62.234.160.98`，但 Windows 正常 HTTP 验证路径返回 302，目标是腾讯云/DNSPod `webblock.html`；ACME 验证端从 `43.174.225.201` 收到 HTML，无法取得挑战文本。未替换生产证书，未将模拟失败表述为自动续期已修复。已有 `certbot.timer` 保持运行；需要解决域名访问限制后再次验证 HTTP-01，或另行配置有明确凭据范围的 DNS-01 自动续期。没有把腾讯云账户密钥复制到服务器。

证据：[重载与续期检查](../artifacts/cloud-api34935-renewal.json)、[公网 DNS / HTTP 核对](../artifacts/cloud-api34935-renewal-network.json)。

## 运维

在 `ssh ubuntu@62.234.160.98` 后执行：

```sh
sudo systemctl status coop-bench-api-proxy --no-pager
sudo nginx -t -c /etc/coop-bench/api-proxy.conf
sudo systemctl reload coop-bench-api-proxy
sudo journalctl -u coop-bench-api-proxy -n 50 --no-pager
sudo journalctl -t coop_bench_api_proxy -n 50 --no-pager
curl --fail https://coop.neutrinophysics.cn:34935/api/v1/health
```

服务配置通过 `ExecStartPre` 检查，重载明确使用新 unit 的主进程；不要使用未指定配置的 `nginx -s reload` 代替。原全局 Nginx 仍保持停止。将来若重新启用它，需要协调 80 端口的归属。

实现参考：[Nginx 独立配置与重载](https://nginx.org/en/docs/beginners_guide.html)、[代理请求头](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)、[syslog](https://nginx.org/en/docs/syslog.html)。
