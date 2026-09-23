# 0.11.12 Windows 更新下载修复

用户在 Windows 客户端点击检查更新能发现新版本，但下载时报“请检查 GitHub 网络连接和磁盘空间”。只读核验本机运行的是0.10.1，旧更新器与0.11.11源代码相同；原错误被 task() 的总括异常处理覆盖，无法从客户端提示反推出最初的网络/文件系统异常。检查时C盘空余225GB、更新目录ACL允许写入；本机GitHub元数据200、安装包第一跳302到release-assets.githubusercontent.com、第二跳200且Content-Length与公开Release一致。用旧更新器同源逻辑从0.10.1完整下载0.11.11到真实客户端更新目录，111544194字节和SHA-256 6c9c2b26ab118ca0312f3525849936e962460836924a71b38d72eeaeb93ee4be均匹配。故没有证据认定当时是磁盘损坏或发布包错误；原始异常已被旧版丢弃。

0.11.12 对安装包阶段的临时连接异常/429/5xx最多自动重试两次，每次重新从经过验证的GitHub发布地址取得临时下载地址、从头写入.part，最终仍严格验证字节数与SHA-256。重试不会放宽重定向域名或凭证边界。下载时限从10分钟延长至30分钟；超时、空间不足、不可写分别给出具体提示，其他未知异常仍不回显原始URL/路径。连接中断重试测试验证旧.part清理和最终文件完整；空间不足测试验证用户可读分类。126项单元全通过，Windows开发应用131项回归通过，包含更新器模拟下载/校验流程。

代码/tag c08e6e469ee865653076bbf21e86385c7ebe33f9 / v0.11.12。正式四平台流水线 [35802167511](https://github.com/neutralino-ai/coop-bench/actions/runs/35802167511) 全通过：Windows和两种Mac开发/包内管理端131项、Player25项，iOS原生/模拟器76项；Intel与Apple Silicon管理端和Player最终ZIP/DMG均签名、公证、附票据，Gatekeeper接受。TestFlight签名构建0.11.12（34.1）已上传；Apple只读查询processingState=VALID、internalBuildState=IN_BETA_TESTING，build id b8f0b24c-2c7b-46cb-a4a2-1463476cf162。实体设备未验收。

[公开Release](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.12) 于2026-09-23 00:49:31 UTC发布，12附件含同版Xcode工程。[公开下载验收35803777999](https://github.com/neutralino-ai/coop-bench/actions/runs/35803777999)成功：旧0.10.1更新选择逻辑发现新版、无凭证实际下载111544538字节Windows包并校验SHA-256、同版iOS工程也下载校验。报告保存在 artifacts/v01112-public-download/verification.json。

发布后本地匿名GitHub检查一度收到频率限制，诊断过程改用已发布固定标签的只读元数据；实际安装包仍以无凭证连接由0.11.12更新器下载、验证大小和SHA-256，保存在用户真实更新目录 `C:\Users\xuefe\AppData\Roaming\Coop Bench Client\updates\Coop-Bench-0.11.12-win-x64.exe`。本地文件的111544538字节和SHA-256与公开Release及独立CI报告完全一致。当前0.10.1进程未被停止、替换或自动安装；用户可在不进行对局时关闭客户端并手动运行已验证的同版安装包。没有部署服务端或中断对局。来源诊断与验收数据在忽略目录 artifacts/v01112-*，不进入公开仓库。
