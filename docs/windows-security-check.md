# Windows 本机安全检查

检查日期：2026-09-17，北京时间。结论：**Windows 防火墙已开启；本机桌游服务只接受本机连接。本次检查没有发现 Defender 威胁记录，但不能据此保证整台电脑没有被入侵。**

## 已核实的状态

| 项目 | 检查结果 |
| --- | --- |
| Windows 防火墙 | Domain、Private、Public 三种配置均为 **ON**；默认策略均为阻止入站、允许出站。当前网络使用 Public 配置。 |
| 桌游服务 | 消息更新后 PID **15744**，Node **24.21.0**，健康检查正常；监听 **127.0.0.1:8788**。这个监听地址不能直接接受其他电脑的连接。见 [最新运行记录](../artifacts/artifact-release/local-messages-verification.json)。 |
| Microsoft Defender | 防病毒服务、实时保护、行为监控和防篡改保护均已开启。病毒库更新时间为当天 **06:54:08**。 |
| 快速扫描 | **13:41:03—13:42:56** 完成一次快速扫描；**13:57:28** 再次读取 `Get-MpThreat`，记录为空。 |
| ToDesk | 按用户明确要求保留。现有 ToDesk、ToDesk_Service、ToDesk_Session 的宽范围允许规则及远程访问用途保留。 |

防火墙开启并不表示所有入站连接都会被阻止：显式允许规则仍会生效。ToDesk 的规则允许任意远端地址；仅凭这份规则快照不能证明某个端口可以从公网连入。

## 已完成的收紧

经审阅并提升权限运行脚本后，已禁用旧 Node 运行时的两条 **Public / 入站 / 允许任意远端与端口** 规则，分别涉及 TCP 和 UDP。结果文件记录 `ok: true`，两条规则均为禁用状态。该操作减少了旧 Node 程序意外监听外部地址时的放行范围。

如确实需要恢复这两条规则，在项目目录中，以管理员身份打开 PowerShell 后执行：

```powershell
.\scripts\harden-local-windows.ps1 -Rollback
```

脚本依据保存的规则标识、程序路径、方向和 Public 配置逐项核对后重新启用规则。回滚会恢复这两条宽范围入站授权，需要保留 `artifacts/security-2026-09-17/node-firewall-before.json`。

## 远程测试的部署边界

按用户最新选择，供同事使用的桌游实例已部署到独立腾讯云主机；本机保持当前 loopback 服务，ToDesk 继续用于远程访问。云端正常 API 与 HTTPS 浏览器验收结果见 [安全审计记录](security-audit.md)，部署配置见 [腾讯云部署说明](cloud-deployment.md)。公网攻击检查未执行，不能用功能验收替代该项结论。

本次没有从互联网执行主机端口扫描，没有验证家庭路由器或运营商网络的外部可达性，也没有完成系统级取证。快速扫描、空威胁记录和本地监听检查覆盖的范围有限；本报告不能作为“电脑绝对安全”或“未被入侵”的证明。

## 保存的证据

- [防火墙策略、允许规则与威胁记录](../artifacts/security-2026-09-17/windows-firewall-review.json)：13:38 的检查快照。
- [两条 Node 防火墙规则的收紧结果](../artifacts/security-2026-09-17/windows-hardening-result.json)：13:44 执行完成。
- [Defender 扫描后保护状态](../artifacts/security-2026-09-17/defender-after.json)。
- [扫描后的威胁记录](../artifacts/security-2026-09-17/defender-threats-after-scan.json)。
- [桌游服务监听、运行时与健康状态](../artifacts/security-2026-09-17/local-server-after.json)。

这些文件是检查时的证据；进程 PID、软件状态和网络配置以后可能变化。
