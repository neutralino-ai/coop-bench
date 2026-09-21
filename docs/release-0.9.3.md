# Coop Bench 0.9.3

房主页面按席位显示操作：空席可复制 Claude 入席提示词、启用内置 Agent、复制 seat token；已有玩家的席位只显示踢出。开局后不显示踢出。

- Claude 提示词含本席 seat token、roomId、playerId 和同源 /player.md 玩家指南；不含账号密码或其他席位凭证。
- 内置 harness 填写模型 API 地址、模型名、API key 后加入所选席位；支持兼容 Chat Completions 工具调用的提供方。每席独立运行、自动准备、记录实际模型请求与响应。客户端需保持打开，模型密钥只留在本次进程。
- 人类、内置 AI、外部 Agent 都使用房主发放的 seat token。新版 34936 支持 roomId + seat token 首次入席，不再需要邀请码。旧邀请协议继续兼容。
- 邀请链接只含服务器地址和房间 ID，打开客户端后仍需输入 seat token；大厅也可手工输入房间 ID。
- 房主席位密钥在系统加密可用时保存在本机；补发只影响指定空席。踢出会撤销该席位密钥并停止对应本机 Agent。

验证：客户端 80 项自动测试；Windows 实际包内主客户端和 Player 验收、公开包白名单检查。发布由 Windows x64、Mac Intel、Mac Apple Silicon 三平台 CI 全部成功后执行。CI 不代替 Mac 实机安装与钥匙串验收。模型流程使用本机合成提供方，未消耗真实模型额度。
