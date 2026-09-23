# 工程质量整改交付

工程改造已实现；通过 PR 和受保护 main 合并，生产部署与应用发版不在本次范围。

旧 checkout 的 15 路径在本地恢复分支 codex/recovery-player-ui-20260923、提交 7f96e1b 保留；本次质量工作从公开 main 21278d1 开始。原始字节快照留在工作区忽略的 artifacts/engineering-quality/before，不进入公开仓库。

## 本地验证

- Node 24.21.0 执行检查；pnpm 11.19.0。静态检查零 lint 错误/警告，严格类型范围通过。
- 132 项客户端测试通过，无跳过。四平台结果以此 PR 的远端检查为准。
- 生产依赖安全审计：已知漏洞 0（本次注册表快照，不能替代安全审计）。
- release-source 和 repository-policy 有真实临时 Git/文件负例；未提交、未跟踪、换提交、错误 PRD、私有文件、类型弱化会失败。
- 本地构建通过；Windows 沙箱限制 esbuild 父目录读取，使用明确主机权限完成构建，未更改产品安全设置。

## 追溯和限制

旧恢复分支保留较早 UI 状态；这些功能后续已在 main 演进，包括历史保留、提示知识和紧凑回放。不能直接把旧分支整合回 main 以免倒退；原始改动已完整提交供追溯。

尚未完成的全量 JavaScript 类型迁移、独立安全审计和实体设备验收见 [技术债](quality-debt.md)。本轮不声称达到未经定义或第三方认证的工业级标准。

## 远端验收与合并条件

[首轮完整 CI](https://github.com/neutralino-ai/coop-bench/actions/runs/35847558563) 全部通过，包括 Windows、Intel/ARM Mac、iOS 原生/模拟器及 quality；该轮源码 12df839。最后补充的发布产物来源比对、直接打包入口/恢复发布约束及 lint 的浏览器/Node 分域检查已作针对性本地验证。最终提交仍必须通过 [本 PR 的全部检查](https://github.com/neutralino-ai/coop-bench/pull/1/checks) 才能合并。

main 已设置 PR、最新基线、全部指定 CI、管理员同样受限、禁止强推/删除与讨论解决要求。当前不要求第二位人工批准（批准数 0），不把自检当成独立审计。
