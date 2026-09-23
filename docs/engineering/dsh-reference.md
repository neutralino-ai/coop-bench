# DSH 学习记录

官方项目 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，本次下载固定提交 00102833dfaee1da9f48a3a8eae9d34005a75218（2026-09-23）。参考源码保存在工作区忽略的 evidence/references/deepseek-harness，不复制进任一产品仓库，也不执行其安装或发布脚本。

| 读到的机制 | Coop Bench 的采纳 |
|---|---|
| [根 AGENTS](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/AGENTS.md) 链接架构和子目录规则 | 简短入口，CLAUDE 只链接同一权威；发布历史移出入口 |
| [Agent Notes](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/.agents/notes/README.md) 分 proposed/implemented/rejected，写问题、方案、取舍、验收/风险 | 本项目用 PRD 跟踪需求验收，decision 记录持久取舍；不会声称 DSH 要求统一叫 PRD |
| [文档分层](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/docs/AGENTS.md)：一个事实一个归属，历史不冒充当前规则 | 流程、架构、测试、PRD、决策和交付分开；本地链接/状态/入口长度可执行校验 |
| [验证标准](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/docs/testing.md)：真实入口、持久状态、单元/e2e/快照各有责任 | 保留真实 PG、真实包与 iOS 检查；本地按影响面，CI 完整矩阵 |
| [pre-push](https://github.com/deepseek-ai/deepseek-harness/blob/00102833dfaee1da9f48a3a8eae9d34005a75218/.agents/skills/dsh-pre-push-checks/SKILL.md) 核实 base、按变更选证据 | 一个任务一个分支、可评审提交、合并前检查当前结果，禁止脏树发布 |

不照搬 DSH 的全插件架构、单文件 100% 覆盖率目标或 DeepSeek 内部密钥/推理成本政策。它们不能替代本项目的信息隔离、真实对局保护和公开/私有边界。此次只借鉴管理机制，没有将外部 AGENTS 当成执行本工作区的指令。
