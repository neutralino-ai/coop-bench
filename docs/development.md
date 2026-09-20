# 客户端开发与验证

Node 24.21+、pnpm 11.19.0。Windows 和 Mac 各用原生依赖，不复制别的系统的 node_modules 或本地会话。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm desktop
pnpm desktop:player
pnpm dist:win
pnpm dist:player:win
```

Mac 使用 pnpm dist:mac 与 pnpm dist:player:mac，或 electron-builder 的 --mac dmg zip --arm64 / --x64。CI 分别使用 Windows x64、Mac Intel、Mac Apple Silicon。

desktop/ci-client-smoke.mjs 和 desktop/ci-player-smoke.mjs 接受真实可执行文件路径、隔离输出目录和期望 arch，针对合成 mock API 检查 UI 与网络协议。必须确认退出码、ok、packaged、arch。这些测试不运行真实游戏核，不验证模型能力。

公开包不含 --local 服务；需要本地服务器的开发者应在私有后端工程单独运行，只把 API URL 提供给此客户端。不要把私有后端作为公开 CI artifact 或构建依赖。

手工验收需另记实际安装、钥匙串、登录恢复、睡眠恢复、连接灯、设置和回放体验；自动 UI 检查不能替代这些。
