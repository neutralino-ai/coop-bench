# 以 Git 提交和可执行检查作为交付边界

Status: implemented

## Problem

运行中的服务来自长期未提交源码；入口日记、共享工作树和缺少静态检查使接手与验证不可靠。

## Decision

借鉴 [DSH 分层管理](../engineering/dsh-reference.md)：短 AGENTS、PRD 验收、持久决策和交付证据各有归属。每任务隔离分支，提交先于制品。CI 将类型/lint/行为/真实数据库或原生包检查连接起来，发布清单记录不可变 Git 身份。

## Alternatives considered

- 只补交当前文件：能恢复历史，不能阻止再从脏树发布。
- 为所有修改强制长 PRD：日常小修复成本过高，故保留 PR 正文流程。
- 一次性把全部 JavaScript 重写成 TypeScript：跨运行器、Electron、WKWebView 的风险难以隔离，先严格核心协议和后端，全量 lint，按模块迁移前端；不以类型抑制假装清零。
- 照搬覆盖率 100%：不保证权限或实验信息边界，优先真实行为和负例。

## Consequences

历史恢复提交较大，保留真实整理边界，不伪造小提交历史。未来要求小而完整的 PR。新增检查提高失败可见性，也可能阻止旧的手工打包习惯。完整类型覆盖、性能预算和独立安全审计仍需 [技术债](../engineering/quality-debt.md) 中的可验收任务。
