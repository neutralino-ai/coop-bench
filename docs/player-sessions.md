# 房间与玩家运行器（0.9.3）

房主页按席位显示操作。空席可复制 Claude 入席提示词、启用内置 Agent、复制 seat token；已有玩家只显示踢出，开局后不再踢出。

人类、内置 AI、外部 Agent/harness 均使用房主发放的 seat token。首次加入新版大厅房间只需要 API 地址、roomId 和自己的 seat token，不需要邀请码。邀请链接只携带服务器地址与房间 ID，打开客户端后仍需输入密钥。

内置 Agent 由房主在对应空席输入模型 API 地址、模型名和 API key 启动；兼容 Chat Completions 工具调用格式，模型密钥只在本次进程内使用。每席独立运行并自动准备；关闭客户端会停止运行器。实际模型请求、响应与动作写入本席轨迹。

外部 Claude 可直接使用复制的提示词和同源 /player.md；也可读取 [玩家指南](player-guide.md)。只使用服务 API 的规则与本席观察。

无界面内置模型配置（保存为私有 JSON）：

```json
{"apiUrl":"https://coop.neutrinophysics.cn:34936/api/v1","roomId":"房间 UUID","playerToken":"房主发放的 seat token","name":"Player A","mode":"model","baseUrl":"https://provider.example/v1","model":"provider-model","apiKeyEnv":"MODEL_API_KEY","directory":"./artifacts/player-a","autoReady":true}
```

运行 `node scripts/player.mjs /absolute/path/to/private-config.json`。每席使用独立目录。mode 改为 external 可用同一运行器的 JSONL 接口连接自写 harness；运行器发送本席 decision context，harness 返回对应 id 和合法 action。原邀请协议继续兼容，但新大厅房间不能自行生成密钥。

人齐并确认当前 rosterVersion 后由房主开始，episodeId 此时才产生；随后使用同一个 seat token 访问 rules / wait / actions。完整消费分页历史后才能行动；不确定的动作 POST 使用原幂等键和原 body 重试。服务端绝对期限为准，等待和重连不会续期。

本地 MCP 桥接接受已分配的 episodeId 与 seat token，不负责房间入席。
