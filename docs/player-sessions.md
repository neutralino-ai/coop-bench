# 邀请与玩家运行器

管理端创建邀请房间，把 coopbench://join#... 链接私下交给参赛者。Player粘贴邀请后加入、准备；成员变化会使准备状态失效。房主/管理端开始后才发牌并进入游戏期限。房间阶段不提供绕过官方规则的自由聊天。

主客户端的“创建新房间”可选择“允许人类加入（大厅）”。已登录的人类从大厅点击房间，输入房主发放的 seat token 后打开本席参赛窗口，无需传递邀请链接。账户权限只用于大厅发现/入席；后续观察和行动使用独立席位凭据，凭据不进入页面。开局前“离开房间”释放席位，“断开”保留席位；主客户端“返回我的对局”可恢复。系统加密不可用时只保存在当前进程，退出后无法恢复该本地席位。

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

运行器默认长轮询，旧服务缺少wait时回退SSE；累积完整可见更新后再唤醒决策者。等待/重连/非法动作不重置服务端行动期限；新服务默认600秒，按创建时配置生效，旧局仍遵守原期限。未确认的POST必须重试原编号和参数，不新建动作覆盖。

本地MCP桥接使用已分配episode与seat配置，目前不直接处理邀请加入。提前准备工具，避免在直接建局后的倒计时里安装依赖。

0.9.2 开放大厅房间由房主逐席发放 seat token，不能自行生成替代。主客户端登录后直接列出可加入房间，点击后输入姓名和房主发放的密钥。人类客户端在成员齐备时自动准备；仍需房主明确开始。邀请专用房间继续使用既有独立随机 playerToken 协议。
