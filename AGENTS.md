# Coop Bench 公开客户端

先读本文件，再读 [开发流程](docs/engineering/development.md)、[架构边界](docs/engineering/architecture.md) 和 [验证标准](docs/engineering/testing.md)。用户当前指令优先；历史交付不是实时部署事实。

## 工作规则

- 开工核对 cwd、remote、branch、status 和最新 main；一项任务一个 codex/ 分支/工作树。main 保持可发布。不得 reset/clean 或覆盖别人的工作。
- 按 [PRD 规则](docs/prds/README.md) 给复杂功能、跨端协议和持久化变更写可验收需求；小修复在 PR 中说明即可。长期取舍放 [决策记录](docs/decisions/2026-09-23-engineering-quality.md)。
- 新功能、契约、测试、文档同一 PR；按可评审行为拆提交。当天/任务结束提交检查过的工作；未完成工作放 WIP 分支并交代失败检查，不能作为发布基线。
- 不用只改文件数/覆盖率/截图替代行为证据；不删除失败断言、不扩大 mock、不补造轨迹使检查通过。
- Node 24.21.0+，pnpm 11.19.0，锁文件安装。pnpm check 执行仓库规则、lint、类型检查、测试和构建；改动相关检查本地跑一次，CI 负责完整平台矩阵。
- 新模块和新边界用严格类型；现有 any 只能减少。明确 runtime/schema 验证外部 JSON、文件、网络和持久化数据；禁止 ts-ignore/ts-nocheck 掩盖错误。
- 仅包含 web/、desktop/、client/、ios/ 和客户端工具；禁止把私有 src/、游戏核、数据库、部署材料或旧完整历史带入此仓库。
- 玩家只使用本席 API 和凭据。禁止把管理员观察、队友牌面或其他席位的私有消息交给玩家；规则只从本局服务 API 取得。
- 所有真实轨迹/附件永久保留，容量到限拒绝新写入。显式管理员删除功能只按用户具体授权执行；不能在维护中自行清历史。不可获得的隐藏思考不能伪造。
- 凭据、邀请、模型 key、真实日志、数据库和原始截图留在忽略的私有目录。提交前检查 staged；自动扫描不能证明没有秘密。
- 保持 Electron sandbox、contextIsolation、CSP、受限 IPC、系统凭据存储与 HTTPS。手机与桌面测试使用合成账号及隔离用户目录。
- 发布/部署必须来自干净提交，pnpm check:release 通过，制品记录 commit/tree 与摘要；先提交再打包。打包/测试通过不代表已上线。
- 每次发布统一桌面/iOS 版本；三桌面与 iOS CI、签名公证、TestFlight 和公开附件验证都通过。工程包、上传成功、Apple 可测与实体设备验收分开报告。
- 交付说明写准确提交、运行过的检查及失败/跳过原因、未完成工作。不要每次往 AGENTS.md 追加发布日记；历史见 docs/*delivery* 和 Git。

## 当前接手位置

[质量整改 PRD](docs/prds/2026-09-23-engineering-quality.md) · [DSH 学习与适用范围](docs/engineering/dsh-reference.md) · [技术债](docs/engineering/quality-debt.md)
