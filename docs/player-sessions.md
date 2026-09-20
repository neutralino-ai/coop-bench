# 邀请与玩家运行器

管理端创建邀请房间，把 coopbench://join#... 链接私下交给参赛者。Player粘贴邀请后加入、准备；成员变化会使准备状态失效。房主/管理端开始后才发牌并进入游戏期限。房间阶段不提供绕过官方规则的自由聊天。

Player可选人工或模型模式；模型需要baseUrl、model、API key。模型密钥只用于模型提供方，不发给游戏服务器。最小运行器目前使用Chat Completions工具调用格式，不能假定所有提供方完全兼容。

## 无界面模型

私有配置：

```json
{"invitation":"organizer-provided-invitation","name":"Player A","mode":"model","baseUrl":"https://provider.example/v1","model":"provider-model","apiKeyEnv":"MODEL_API_KEY","directory":"./artifacts/player-a","autoReady":true}
```

```sh
node scripts/player.mjs /absolute/path/to/private-config.json
```

## 外部 Agent / 子智能体

配置 mode: external，使用同一个 scripts/player.mjs。运行器输出本席规则/decision JSONL；外部Agent只返回协议要求的合法action。每席独立进程和目录，不读取兄弟席位的文件或会话。实际协议见 client/runtime.mjs 与 scripts/player.mjs；先在受控环境确认真实工具调用，不编造工具结果。

运行器默认长轮询，旧服务缺少wait时回退SSE；累积完整可见更新后再唤醒决策者。等待/重连/非法动作不重置60秒行动期限。未确认的POST必须重试原编号和参数，不新建动作覆盖。

本地MCP桥接使用已分配episode与seat配置，目前不直接处理邀请加入。提前准备工具，避免在直接建局后的倒计时里安装依赖。
