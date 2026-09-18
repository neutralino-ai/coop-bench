# 四人远程测试：私有网络 + 独立凭据

状态：应用侧支持已实现并通过本地测试；本机未自动安装、登录或启用 Tailscale，未开放公网端口。真实跨网络连接需要完成下面的部署与验收。

## 推荐拓扑

测试者没有固定公网 IP、也不在同一局域网，适合通过 Tailscale 私有组网访问。它支持 NAT 穿透；无法直连时可使用中继，所以不要求每位同事有公网 IP。[连接方式](https://tailscale.com/docs/reference/device-connectivity)

```text
同事 A / B / C / D：自己的 Tailscale 身份 + 自己的应用凭据
             │ 私有网络，访问策略仅允许这四人
             ▼
https://desktop501.<真实 tailnet>.ts.net:443
             │ Tailscale Serve 终止 HTTPS
             ▼
http://127.0.0.1:8788  →  Coop Bench  →  本地 SQLite
```

应用继续只监听 `127.0.0.1`。Tailscale Serve 为私有网络提供 HTTPS 入口；这里使用 Serve，不启用会公开到互联网的 Funnel。Serve 官方也建议后端只监听 localhost，避免其他网络设备绕过代理。[Serve 与身份头](https://tailscale.com/docs/features/tailscale-serve)

Windows 与 macOS 均有官方客户端。访问者需要安装客户端、登录自己的身份；主机必须保持开机和联网。[安装说明](https://tailscale.com/docs/install)

## 权限设计

| 凭据 | 用途 | 不具备的权限 |
|---|---|---|
| 本地 coordinator | 未启用共享时，主机所有者的管理操作 | 启用共享后，整个 HTTP 服务都禁止使用，包括 localhost 入口 |
| auditor | 浏览已结束 rollout、添加 review | 新建/中止游戏、读取进行中完整轨迹、导出训练数据 |
| operator | 组织测试、新建/中止游戏、审计与导出 | 绕过其他游戏座位的 token 验证 |
| seat token | 单个智能体操作自己的座位 | 人类审计接口、其他玩家座位 |

这四人属于同一个测试团队；operator 可以看到团队的全量审计数据，因而必须是可信的实验组织者。它不是多租户隔离，也不是隐藏信息游戏中的普通玩家身份。智能体继续使用各自的 seat token。

每个应用凭据独立生成 256 bit 随机值，服务端配置只保存 SHA-256 摘要；默认 30 天后过期，可以单独吊销。凭据仅写入显式指定的新文件，命令不打印其值。网页在内存中使用凭据。

## 1. 创建四个独立应用凭据

以下命令在 `coop-bench` 项目目录中运行。示例数据目录与当前演示服务一致；如果使用桌面应用的另一数据目录，请替换 `--data-dir`。在安全位置保存输出文件，分别把每个人的文件交给对应的人，不要发 coordinator 文件。

```text
node scripts/manage-access.mjs add --data-dir data/local-server --id tester-a --role auditor --out data/private-credentials/tester-a.txt
node scripts/manage-access.mjs add --data-dir data/local-server --id tester-b --role auditor --out data/private-credentials/tester-b.txt
node scripts/manage-access.mjs add --data-dir data/local-server --id tester-c --role operator --out data/private-credentials/tester-c.txt
node scripts/manage-access.mjs add --data-dir data/local-server --id tester-d --role operator --out data/private-credentials/tester-d.txt
node scripts/manage-access.mjs list --data-dir data/local-server
```

这些角色只是部署示例，可按实际职责全部使用 auditor 或 operator。创建出的 `access-users.json` 是服务端配置；凭据文件不要放入 `web`、共享目录、代码库或实验训练集。Windows 上应保存在当前用户的私有资料目录，并限制文件 ACL；Unix 创建文件使用 `0600`。

吊销即刻影响后续请求，不需重启：

```text
node scripts/manage-access.mjs revoke --data-dir data/local-server --id tester-b
```

替换泄露凭据时，先吊销旧 id，再创建一个新 id。过期默认 30 天，`add` 支持 `--expires-in-days 1` 至 `365`。本地配置管理命令由主机所有者顺序执行。

启用共享时，主机所有者也需要自己的 operator 凭据。可以用同样的命令额外创建 `owner`，并把自己的凭据文件保存在本机。不能通过更改 Host 绕回 coordinator 权限。

## 2. 配置私有网络访问策略

在 Tailscale 管理界面邀请同事，或者只将本机共享给四个外部用户。官方支持向外部用户分享单台设备；分享仍然遵循本网络的访问策略。[设备分享](https://tailscale.com/docs/features/sharing)

下例是专用测试网络的策略模板。替换四个登录邮箱和主机的 **Tailscale IP**；它不是家庭宽带公网 IP。验证策略后，只允许这四个人访问该主机 TCP 443。

```json
{
  "hosts": { "coop-bench": "100.101.102.103" },
  "grants": [
    {
      "src": ["tester-a@example.com", "tester-b@example.com", "tester-c@example.com", "tester-d@example.com"],
      "dst": ["coop-bench"],
      "ip": ["tcp:443"]
    }
  ],
  "tests": [
    {
      "src": "tester-a@example.com",
      "accept": ["coop-bench:443"],
      "deny": ["coop-bench:8788", "coop-bench:22", "coop-bench:3389"]
    }
  ]
}
```

已有网络中的其他规则需要一起审查。授权规则取并集：添加这个窄规则不能覆盖已有 `* → *` 的宽规则。避免直接覆盖已有网络的合法用途，在管理界面验证最终策略与测试断言。[Grants 语法](https://tailscale.com/docs/reference/syntax/grants)

## 3. 配置精确代理域名

从 Tailscale 管理界面获取本机完整 `machine.tailnet.ts.net` 名称，设置应用环境变量：

```powershell
$env:COOP_DATA_DIR = (Resolve-Path 'data/local-server').Path
$env:COOP_USERS_FILE = Join-Path $env:COOP_DATA_DIR 'access-users.json'
$env:COOP_TRUSTED_PROXY_ORIGIN = 'https://desktop501.REPLACE-WITH-REAL-TAILNET.ts.net'
node src/server.ts
```

示例域名必须替换为真实、全小写的 Tailscale 名称。实际服务如已经运行，应先停止同一数据目录的旧实例，再使用这些环境变量启动。macOS 使用 shell 的 `export` 设置相同环境变量。

应用只接受配置的完整 HTTPS origin，不接受通配域名、其他 Host、伪造的 `X-Forwarded-Host`，也不将 `X-Forwarded-For` 或 Tailscale 身份头当作应用登录凭据。真实 socket 对端必须仍然是 loopback。凭据授权与网络访问控制分开验证。

在已完成身份与访问策略配置后启动 Serve：

```text
tailscale serve --bg --https=443 http://127.0.0.1:8788
tailscale serve status
```

首次使用可能要求在 Tailscale 管理端启用 HTTPS；按官方指引完成。`--bg` 使入口在后台运行。停用这一入口：`tailscale serve --https=443 off`。[Serve 命令](https://tailscale.com/docs/reference/tailscale-cli/serve)

## 4. 真实部署验收

1. 本机服务监听地址仍是 `127.0.0.1:8788`；路由器和 Windows 防火墙未开放该应用的公网入站端口。
2. 四个被批准的身份从不同网络打开 HTTPS 页面，并各自使用独立应用凭据登录。
3. 未加入/未获批准的身份无法访问网络入口；伪造 Host 或转发头无法扩大权限。
4. auditor 不能创建或中止游戏，不能读取进行中的完整 rollout；普通 seat 无法人类审计。
5. 吊销一个人的应用凭据，已打开页面的下一次 API 请求失败；其余用户继续使用。
6. 在 Tailscale 同时撤销该用户的分享/网络授权，验证其网络连接也失败。

本次本地自动化测试覆盖应用边界与凭据逻辑，不等同于上述真实 Tailscale 部署验收。应用不依赖家庭 IPv6/DDNS 作为这条访问路径；仍应维护操作系统、Node 与 Tailscale 的安全更新。
