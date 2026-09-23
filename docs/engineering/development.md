# 开发流程

## 接手和隔离

确认 neutralino-ai/coop-bench 公开仓库；fetch main 后从已核实基线建立 codex/任务分支。一个任务使用一个工作树，不在同一 checkout 交错改代码。开工记录 git status --short、HEAD 和目标行为。未提交文件先逐项归属、备份再迁移，不用 reset/clean 清场。

## 需求到提交

非平凡功能先写 [PRD](../prds/README.md)：用户问题、范围/非目标、可观察验收条件、失败与信息边界、验证命令、部署回滚。代码完成后逐项附证据，将状态从 proposed 改为 in-progress，再在验收完成后改为 implemented。实现与原要求有差异时更新最终范围，不能仅勾选原清单。

可持续影响架构/协议/存储的取舍写 docs/decisions；日常小修复不强制另写文档。每个提交应有单一评审主题。历史积压恢复是一次性例外：原样保存为恢复提交，整改另提交，不伪造过去的开发顺序。

任务结束不得留下来源不明的脏树。完整改动进入 PR；未完成改动提交 WIP 分支，记录待办与失败检查，不 merge、不部署。已经明确授权的正常开发不再重复索要许可。

## 检查和合并

安装使用 pnpm install --frozen-lockfile。本地按影响面运行相关测试；全局工具/依赖/规则修改执行 pnpm check。CI 会运行完整检查；查看具体 job 和跳过数，不能只看退出码。远端 main 前进后重新评估合并结果，只重跑失效的证据。

使用 PR 合并到 main，禁止强推 main、覆盖发布 tag 或把失败检查改成允许失败。需要改历史时仅在自己的分支使用 force-with-lease。仓库保护配置不属于源文件；保护状态另行验收，不能将本地脚本称为服务端强制保护。

## 发布

pnpm check:release 必须在干净提交通过；它拒绝 staged、unstaged、untracked 改动。普通 pnpm build 仍可调试脏树，但不能把这种产物冒充可发布版本。依赖锁文件、commit/tree、制品摘要和 CI run 一起记录。

原生包由现有四平台工作流生产；quality job 是打包前依赖。签名、公证、TestFlight 和下载验收仍按原标准执行，不能以本次代码质量 PR 代替发版授权。
