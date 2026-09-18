# 在新电脑上继续开发（0.5.0）

仓库是独立项目：只需克隆 `coop-bench`，不需要旁边再放 `take-time` 或
`ipv6-ddns-desktop`。Windows 和 macOS 使用同一套 TypeScript、Electron 和网页代码。
生产数据、账号凭证、模型轨迹和安装包不进入 Git。仓库为
[neutralino-ai/coop-bench](https://github.com/neutralino-ai/coop-bench)。

## 第一次克隆与运行

安装 Git、Node.js **24.21.0** 和 pnpm **11.19.0**。pnpm 版本与当前锁文件及
`allowBuilds` 配置一致；不要用旧版 pnpm 覆盖锁文件。

```sh
npm install --global pnpm@11.19.0
git clone https://github.com/neutralino-ai/coop-bench.git
cd coop-bench
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm desktop
```

私有仓库的 GitHub 登录由 Git/GitHub CLI 管理，不把 GitHub token 写进项目文件。
客户端默认 API 为 `https://coop.neutrinophysics.cn:34935/api/v1`，可在「设置」中
修改。正常使用用户名与密码登录；首次设置密码，需先通过「个人凭证」入口使用
组织者提供的凭证登录，再在设置面板设置密码。后端须支持新的账户接口，旧后端
仍可使用个人凭证。开发安装不带任何生产凭证，不会自动部署云服务，也不会复制
其他电脑的应用配置。0.5.0 的 Windows 包内远程 27 项、本地 14 项验收和
288 项自动测试已通过；云端账户接口也已部署，owner 尚未设置密码。Windows、
Mac Intel 和 Apple Silicon 的首次 CI 及包内应用验收均通过。[0.5.0 验证记录及安装包下载](release-0.5.0.md)

「记住登录」只加密保存会话，不保存账户密码；不勾选时会话只存在当前进程内存。
个人凭证不能提交到 Git，也不能交给玩家 Agent。详见[远程客户端说明](desktop-client.md)。

需要独立单机环境时运行 `pnpm desktop:local`；仅启动本机 API 时运行 `pnpm start`。
默认只监听本机回环地址。参见[本机服务说明](local-app.md)。

## 日常修改与验证

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec electron . --client-smoke-test --data-dir=artifacts/dev-client-smoke
```

最后一步只生成隔离的合成对局，不使用生产服务或真实用户账号。
先确认 `artifacts/dev-client-smoke/client-smoke-result.json` 的 `ok` 为 `true`。
再次测试应使用新的目录名称，避免上次的合成数据影响验收。

项目尚未采用前端热更新；改完界面后重新运行 `pnpm desktop` 会重新打包本地网页。
修改游戏后必须运行相应测试，并保留历史 episode 的原 build 值。

## 打包

Windows x64 在 Windows 上执行：

```sh
pnpm dist:win
```

Mac 在 Mac 上执行，生成 Intel 和 Apple Silicon 版本：

```sh
pnpm dist:mac
```

输出位于 `release/`。默认未配置发行证书或 Apple notarization；CI 产物属于未签名
测试构建。Windows 本地打包通过不代表 Mac 已经实测；以对应 Mac job 的构建与
桌面验收结果为准。签名凭证以后通过 CI secret 配置，不加入仓库。

## GitHub Actions

`.github/workflows/desktop-build.yml` 在单个仓库根目录安装依赖，运行同一套测试、
构建和合成桌面验收，并分别打包 Windows x64、Mac Intel、Mac Apple Silicon。
`main` push、PR、版本 tag 和手动触发均可执行。仅上传明确列出的安装包、build
manifest 和合成验收截图/报告；不会上传整个 `artifacts` 或 Electron userData。
工作流不自动发布 Release，也不部署服务器。

使用 `contents: read`，checkout 不保留 Git 凭证；CI 不需要服务器 SSH key、
腾讯云 API key 或生产应用 token。运行器架构来自 [GitHub 官方列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
pnpm 在 Intel Mac 上先安装 Node，依据 [pnpm action 文档](https://github.com/pnpm/action-setup)。

## 源码来源与历史回放

- `src/vendor/take-time/{engine,types}.ts` 是原项目源码的逐字节副本。
- `scripts/vendor/env-file.mjs` 是原环境文件解析器副本；`tc3.mjs` 只提取原纯签名
  函数与常量，不包含 DNS 写入客户端。校验值见 [vendor-lineage.json](vendor-lineage.json)。
- 云维护脚本仍需要维护者自己的本地凭证文件和服务器权限；其中的历史固定实例
  参数不是通用部署向导。不要为了测试客户端而运行它们。
- 下载的规则 PDF、图片、HTML 和规则全文不提交。保留官方链接及小型 JSON 来源
  元数据；构建和测试不依赖这些下载文件。

本次独立仓库迁移将 build 指纹升级为 v2：源文件路径统一 `/`，文本 CRLF 统一
LF，纳入 vendored 引擎和类型。Windows/Mac 的同一源码因此得到同一指纹。
这是**新的 build 身份**；旧云上 episode、轨迹和 build 不会被重写。
旧轨迹仍可查看和导出；重新执行旧轨迹需使用对应的原始归档 runtime，不能绕过
`BUILD_MISMATCH` 或把旧 build 伪装成新版本。

## 提交前检查

`.gitignore` 排除 `artifacts/`、`data/`、`tmp/`、`.tools/`、依赖、生成产物、
SQLite、环境文件、常见凭证文件和私钥。忽略规则不是泄密扫描：提交前仍检查
实际 staged 文件，并用离线 secret scanner 检查新增内容。测试中的固定假凭证
需要人工识别，不可把真实凭证加入“允许列表”。

只把脱敏后的研究报告按需放入 `docs/`。GitHub 私有仓库也不应保存生产数据库、
私有模型消息或访问 token；这些继续由后端持久化与备份。
