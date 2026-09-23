# 上传真实比赛轨迹

服务端自动保存游戏动作与结果；模型完整messages需要运行器真实采集并上传。MCP只采集工具调用，不包含宿主未提供的思考。赛后上传原始比赛日志不等于赛后反思。

使用本席私有连接文件和Node24：

```sh
node scripts/upload-agent-artifact.mjs --connection seat.json --file agent-trace.jsonl --metadata trace-metadata.json --receipt upload-receipt.json
```

metadata最小示例：

```json
{"reasoningAvailability":"not-provided","provider":"actual-provider","model":"actual-model"}
```

实际得到reasoning内容用provided，只有决策摘要用summary-only，主动删去用redacted。未知token计数不填，不用零冒充。导出前剔除Authorization与API密钥，并记录脱敏范围。

工具自动计算SHA-256并分块上传、恢复缺块、核对封存。终局后才能建立附件manifest；失败保留原文件重试。服务端标为client-supplied-unverified，验证字节和身份不代表验证思考真实性。

HTTP路径：POST /episodes/:id/artifacts 建manifest，POST /episodes/:id/artifacts/:artifactId/chunks 传块，POST /episodes/:id/artifacts/:artifactId/complete 封存。每次使用本席Bearer头。其他玩家不能读本人的私有日志。

现有每席/messages是单一序号流，不能两个独立记录器各从sequence=0抢写。宿主完整transcript可作为独立artifact补交，关联实际requestId。

## 回放展示

终局回放自动读取已完成的 `agent-trace` 附件，校验长度和 SHA-256 后显示紧凑的六类色块：System、User、Assistant、Thinking、Tool use、Tool result。支持 JSON 消息数组、JSONL 的显式 role 消息、Codex response_item、Claude message/content blocks，以及本项目 model-input/model-output/tool-call/tool-result 记录。不执行日志中的内容，也不把用户引用的推理或加密字段当作实际思考。

同席有多个附件时优先显示最新的可识别轨迹，原始附件仍可下载。缺少轨迹时保留行动理由；未知格式或校验失败明确提示，不把它显示成完整轨迹。消息流仍用于进行中回放。每类内容是否存在取决于实际采集，上传成功不等于六类全部具备。
