# 桌面客户端使用的 API-only 后端

桌面客户端安装包包含界面，通过 `https://coop.neutrinophysics.cn/api/v1` 访问原有 API。云端继续管理规则、鉴权、对局状态、消息、附件与持久保存的轨迹。界面不需要从云端下载 HTML 或 JavaScript。

本次按“北京服务器备案后使用”的安排实施。API-only 配置不解决备案或网络可达性问题。本文及示例只提供本地实现和部署步骤，不能当作已经改动线上服务器的证明。

## 进程配置

`createApi(authority, token, { serveWeb: false })` 关闭 HTML 和静态资源。默认不传该字段时仍为网页与 API 并存，以兼容既有单机应用、测试和开发工作流。

`startLocalApp({ serveWeb: false })` 提供相同能力。环境变量 `COOP_API_ONLY=1` 也会关闭静态资源；显式传入的 `serveWeb` 配置优先于环境变量。无此环境变量或值不为 `1` 时保持原默认行为。

资源在 API 前缀规范化后统一判断，因此 `/play`、`/app.js`、`/transport.js` 以及 `/api/play`、`/api/v1/play` 等别名均返回 JSON 404。游戏、规则、身份、动作、轨迹、消息、附件等 API 和 `/health` 保持原来的鉴权与行为。浏览器模式增加 `/transport.js` 静态资源；该资源在 API-only 模式也不可获取。

CLI 示例：

```powershell
$env:COOP_API_ONLY = '1'
npm run start:headless
```

```sh
COOP_API_ONLY=1 npm run start:headless
```

## 先仅调整 Nginx，保留线上规则引擎版本

现有对局的确定性重放与引擎版本关联。即使规则本身未改，重新构建服务也可能改变构建指纹。因此，只为关闭公网网页时，优先调整 Nginx；无需更换运行中的服务、数据库或规则代码。

1. 保存 `/etc/nginx/sites-available/coop-bench` 的带时间戳副本，并记录当前 `/health` 构建 ID。
2. 仅在该站点的 **HTTPS `server {}`** 中，将现有 `location /` 全路径反向代理替换为 [nginx-api-only.conf](../deploy/nginx-api-only.conf) 的 location 片段。
3. 保留现有域名、证书路径、Host/SNI 检查、TLS、安全响应头、限流区、请求大小/超时、日志配置。不要覆盖其他站点或默认站点。
4. 不修改 HTTP 80 端口上的 `/.well-known/acme-challenge/`、其 `/var/lib/letsencrypt` webroot、续期定时器和证书部署钩子。HTTP 的其余路径可以继续原有 HTTPS 跳转，最终由 HTTPS 返回 404；如有收紧 HTTP 的需要，应独立审阅。
5. 执行 `sudo nginx -t`，成功后才执行 `sudo systemctl reload nginx`。不要为此重启 `coop-bench.service`。
6. 核对 `/health` 和 `/api/v1/games` 返回 200，鉴权仍生效，构建 ID 与步骤 1 相同；`/`、`/play`、`/app.js`、`/api/v1/`、`/api/v1/play`、`/api/v1/app.js`、`/api/v1/transport.js` 返回 404。

示例特意拒绝 `/api/v1/` 下的网页别名：当前旧版后端仍会去除这个前缀后提供网页，只有笼统的 `/api/v1/` 代理不足以关闭网页。该正则 location 需要先于其他冲突的正则，且通用 API location 不能加 `^~`，否则 Nginx 会跳过别名拒绝规则。现有配置若有其他 location，应用前应检查是否产生优先级冲突。

此公网配置仅开放规范 `/api/v1/` 前缀和 `/health`，旧的公网 `/games`、`/episodes`、`/api/...` 兼容路径将返回 404；agent 和桌面客户端应使用完整规范 API 前缀。回环进程内部保留旧 API 兼容能力。

后续需要升级进程时再设置 `COOP_API_ONLY=1`，从应用层也关闭所有静态资源，并按现有发布/备份流程升级。Nginx 限制仍保留。新增静态资源时应同步审视旧引擎旁路的拒绝清单；应用层 API-only 不依赖这份清单。

## 验证范围

[api-only.test.ts](../test/api-only.test.ts) 验证网页与 API 前缀别名全部关闭、健康和游戏目录可读、凭证仍被检查、创建对局和独立玩家观察正常、审计 API 可读、默认网页兼容，以及真实 CLI 对 `COOP_API_ONLY=1` 的处理。

Nginx 文件是接入现有站点的示例片段，必须在目标服务器用实际配置执行 `nginx -t` 并核对路由后，才能声明部署验证完成。
