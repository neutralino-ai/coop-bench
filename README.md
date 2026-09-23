# Coop Bench 客户端

Windows / macOS / iOS 的合作桌游研究客户端：人类创建房间、审计轨迹，玩家通过自己的席位与远程游戏服务交互。

**本仓库只包含客户端和公开接口说明，不包含游戏服务器、规则引擎、部署脚本或数据库。** 2026-09-20 起使用全新的 Git 历史；原完整项目与历史安装包已迁至维护者的私有仓库。旧 checkout 请重新克隆，不要合并旧历史。

## 安装与使用

从 [Releases](https://github.com/neutralino-ai/coop-bench/releases) 下载与你系统相符的管理端或 Player。0.9.1 起安装包仅连接远程 API，不再内置单机后端。Windows 包未签名；0.11.13 的 Mac Intel / Apple Silicon 包已签名、公证并通过最终包 Gatekeeper 检查。CI 验收不能替代真实电脑上的安装验收。

- **Coop Bench 主客户端**：设置 API、登录、创建游戏、从大厅加入人类对局、准备和开始游戏，也可查看与审计回放。
- **Coop Bench Player**：用邀请链接加入，人工行动，或配置模型 API/base URL/model 自动参与。
- **无界面 Agent**：读 [PLAY.md](PLAY.md)，使用本地 MCP 或 HTTP 客户端。不需要桌面应用。
- **iPhone / iPad**：受邀测试者可通过 TestFlight 安装和更新，无需自己的 Mac；也可按 [iOS 工程与安装步骤](ios/README.md) 用 Xcode 自行构建。包含大厅、人类席位、回放和内置 Agent；需要 iOS 17 或更新版本。

旧实验 API 为 `https://coop.neutrinophysics.cn:34935/api/v1`；新实验 API 为 `https://coop.neutrinophysics.cn:34936/api/v1`。两边不共享对局，必须使用组织者给定的地址。0.9.2 新安装默认连接 34936；已有保存地址保持不变，旧对局不会自动迁移。

0.9.2 打开后首先显示密码登录，登录后直接显示“可加入的房间”和“对局回放”两个区块；顶部“创建新房间”。房主发放每席 seat token，玩家点击房间并输入密钥后入席，人齐后由房主开始。进行中的游戏也可回放（按账号权限）。详见 [大厅验收](docs/lobby-client-2026-09-21.md)。

## 文档

- [参赛入口](PLAY.md) / [MCP](docs/mcp-player.md) / [邀请与运行器](docs/player-sessions.md)
- [桌面使用与登录](docs/desktop-client.md) / [原始日志上传](docs/agent-artifacts.md)
- [开发和跨平台验收](docs/development.md) / [公开仓库边界](docs/repository-boundary.md)

## 开发

需要 Node.js 24.21+ 与 pnpm 11.19.0：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm desktop
pnpm desktop:player
```

客户端测试使用明确标记的模拟 API，不包含真实游戏裁决，不代表真实模型得分或后端正确性。
