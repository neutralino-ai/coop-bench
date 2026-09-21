# 桌面 0.9.6 正式交付

2026-09-21 18:24:01（北京时间）已公开发布 [v0.9.6](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.9.6)。版本提交 `acc954ec1ffaf8144acfe943a6ebff65b5ed570c` 来自桌面 main，没有混入并行 iOS 分支。客户端 build 为 `fa8c21871d7cb1f4fe50c037d07ff59c515d6264a1098e5e26ac39349faceedf`。

- [三平台发布工作流 35587997268](https://github.com/neutralino-ai/coop-bench/actions/runs/35587997268) 全部成功：Windows x64、macOS Intel、macOS Apple Silicon，管理端及 Player 包内验收和包内容边界检查通过后才发布。
- 本地桌面单元测试 94 项；Windows 管理端包内 104 项、Player 22 项。为隔离合成 API 验收，不代表真实模型对局或 Mac 手工安装验证。
- Release 有 10 个安装包及 SHA256SUMS，共 11 个资源；旧更新器从 0.9.5 为三种平台均选出 0.9.6。
- 本机公共 GitHub API 出口遇到限流，独立连接运行相同更新器成功取得 available。使用该公开响应在本机运行原有下载器，完整下载 Windows 安装包并通过 SHA-256；未打开或安装。
- Windows 安装器：111525668 字节，SHA-256 `8afc1a030cddc1266524271779e448963297637e280d2afb0efb32b211fbcf94`。更新器实现与 0.9.5 相同。

人类页面的历史、提示知识、点牌确认、颜色/数字选项、1 起始牌位、圆点计数和通知自动消失均已进入公开安装包。输入审计界面已发布，但服务器签发观测接口、输入消息筛选及观战新权限需要配套服务更新。本次确认后端仍有 1 场进行中的对局，因此未切换服务；不要把安装包发布当作这些后端能力已经上线。

本地证据位于忽略目录 `artifacts/release-v096/artifacts/`：`release-unit-tests.txt`、`release-client-smoke/`、`release-player-smoke/`、`public-release.json`、`public-update-verification.json`。前两份玩家页面文档保留开发阶段的历史记录，当前发布状态以本文为准。
