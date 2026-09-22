# 0.11.8 自动刷新和登录回放修复

包含[统一审计读取预算与Agent恢复核验](release-0.11.6-delivery-2026-09-22.md)，以及[附件排队与Retry-After验收](release-0.11.7-delivery-2026-09-22.md)。0.11.6/0.11.7候选流水线已取消，未公开Release，标签保持不变。

另修复登录导航竞态：登录并行加载游戏目录与回放列表，列表先出现时可以立即进入回放；原代码在慢目录请求结束后又强制进入大厅并取消回放。现在初始导航只执行一次，后续目录响应不覆盖用户新导航。登录前的回放链接先保存，仅在用户没有选择新页面时打开。单元回归在修复前明确失败、修复后通过；iOS模拟器网络夹具延迟目录1.5秒，覆盖该加载顺序。

本次只更新公开客户端，没有改动服务器限流、部署后端或中断对局。内置Agent原有网络重试、原席位与模型上下文恢复行为经过核验，恢复入口和限制详见0.11.6记录。实体设备验收与CI证据分开。

版本/tag 为 `2e3f88845b70a8bb75431fe1ea478b0950b73b4d`，流水线 [35705482603](https://github.com/neutralino-ai/coop-bench/actions/runs/35705482603)。本地118项单元、最终Windows管理端126项通过；CI Windows管理端126/Player25及iOS模拟器68通过，原生签名IPA为0.11.8（30.1）。网络夹具确认丢失一次成功动作响应后，使用完全相同请求编号和动作重试一次。实体设备未验收。

首次Apple Silicon任务的独立Player倒计时断言出现测试竞态：测试临时render过期时钟，再分多次IPC读取；正常服务端推送在读取间恢复实际倒计时03:00，导致期望00:00的断言失败。其他平台及此前包内验收通过。保留失败报告 `artifacts/v0118-ci-mac-arm/ci-player-smoke/player-smoke-result.json`，只重跑该任务确认同一标签。后续主分支验收脚本把合成render及三项取值放到同一renderer任务，本地25项通过；该纯测试修正不改写0.11.8标签或产品倒计时逻辑。

独立版本说明 `docs/release-0.11.8.md` 在标签之后补齐。自动发布步骤若因标签内缺此文件失败，将在所有平台和TestFlight上传通过后，使用本轮原始签名附件与校验和完成发布，不重建安装包或移动标签。

最终四平台及TestFlight上传均通过，Apple Silicon单任务重跑后，管理端126项、Player25项通过；两种Mac架构的ZIP/DMG签名、公证票据、Gatekeeper全部accepted。签名使用维护者Xuefeng Ding的既有Apple身份。iOS模拟器68项和原生检查通过；Apple只读核验0.11.8（30.1）为VALID / IN_BETA_TESTING，build id `94005a4e-cc9d-498d-92a0-376f52e01b6a`。未声称外部测试审核或真机验收完成。

原流水线最后发布步骤因标签内缺版本说明失败。补发流水线 [35710279720](https://github.com/neutralino-ai/coop-bench/actions/runs/35710279720) 验证原标签SHA和五项平台/TestFlight成功结果后，在GitHub内部下载并上传同批签名包；最后查询草稿的tag端点返回404，因此在本机通过稳定release id逐项核对12个远端附件size/state/SHA-256后公开。后续补发脚本已改用稳定id。没有重建安装包或移动版本标签，不把这两个发布步骤失败写成整条CI全绿。

[公开Release](https://github.com/neutralino-ai/coop-bench/releases/tag/v0.11.8) 于2026-09-22 09:29:18 UTC发布，12附件包含同版Xcode工程。远端12项SHA-256均与原始验收文件一致。原证据、首次失败与重跑证据分别保留在忽略目录 `artifacts/v0118-*`。

最终[公开下载验收35711315409](https://github.com/neutralino-ai/coop-bench/actions/runs/35711315409)成功：不携带认证信息，从公开Release验证12附件与11条安装包/工程校验和，旧0.10.1版本选择逻辑识别新版，实际下载111543589字节Windows安装包并校验SHA-256，181515字节同版iOS工程也下载校验成功。使用的更新器模块与此前旧客户端模块SHA-256一致。报告已保存至 `artifacts/v0118-release-ci-verification/verification.json`。本地GitHub链路中断，最后下载验收改在CI完成；临时本机SSH/CONNECT辅助通道在交付结束时关闭，没有修改服务端监听或部署配置。
