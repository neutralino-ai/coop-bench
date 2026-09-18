# 0.5.0：设置、个人密码与独立仓库

2026-09-18 完成。本次交付的 Windows x64 客户端包含服务器设置、账号状态、首次设置密码和修改密码。默认 API 为 `https://coop.neutrinophysics.cn:34935/api/v1`。

## 使用

首次使用仍需自己的个人凭证：选择“高级：个人凭证”连接，打开“设置 → 账号与密码”设置密码。此后用账号 ID 和密码登录；owner 的账号 ID 是 `owner`。管理员不给同事共享 owner 凭证，每位同事使用自己的账号。

密码由使用者输入，没有随安装包预置。服务端使用随机盐 scrypt，客户端仅可选加密保存短期会话。Agent 仍用独立座位凭证，见 [账号接口](human-auth.md)。

## 验证与部署

- 自动测试：288/288；Windows 实际打包程序：远程 27 项、本地兼容模式 14 项。
- 18 个包内文件与已检查源码、运行时逐字节一致，没有生产凭证或轨迹。
- 安装器 `Coop-Bench-0.5.0-win-x64.exe`，111,507,757 字节，未签名；SHA-256：`20c2e555a95da2bc402bc76f47fb04f560c2396b30f8eed9f6a0829d1e271d06`。
- 云端部署 build：`0286cbc0bbd21bfe0c8e2797f71dba2474c198cc25ec60c36a293d173b285af0`。公网包内客户端只读验收 15 项、API 入口检查 36 项通过。
- 旧游戏库 17 张表的逐行哈希完全一致，保留 3 局、372 条消息、9 个附件；旧 build 没有改写。历史审计可读，旧引擎的重放仍需要对应版本。
- 升级前后均备份游戏库；新认证库独立保存并纳入每日备份。没有设置生产密码，owner 状态为待首次设置。
- 其他应用和全局 Nginx 配置未改，报销服务与独立代理的主进程未更换。

详细本机验证报告在被 Git 忽略的 `artifacts/` 中：`client-release.json`、`settings-all-tests.txt`、`cloud-auth-upgrade-result.json`、`cloud-api34935-desktop-live-check/report.json`。

## 跨机器开发

私有仓库：[neutralino-ai/coop-bench](https://github.com/neutralino-ai/coop-bench)。依赖已内置，不需要克隆旁边的项目。源码、锁文件及构建流程进入 Git；真实凭证、数据、轨迹、安装包和机器配置均不进入 Git。见 [开发说明](development.md)。

Windows x64、Mac Intel 和 Mac Apple Silicon 的首次原生 CI **全部通过**，每个平台均运行了打包后应用验收。[CI 运行及安装包下载](https://github.com/neutralino-ai/coop-bench/actions/runs/35302731612)，对应代码提交 `0b9c6eb8d4f7583cfd8dc43adfa670ef8edeb2dc`。

登录 GitHub 后，在运行页面的 Artifacts 中选择 `coop-bench-windows-x64`、`coop-bench-macos-x64` 或 `coop-bench-macos-arm64`。产物保留 14 天，之后仍可从源码重新构建。安装器尚未签名或完成 Apple 公证，CI 未执行安装向导的人工验收。
