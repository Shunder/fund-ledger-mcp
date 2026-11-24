# 网页端部署与接入

需要能管理这个私有 GitHub 仓库、一个 Railway 项目、一个 Auth0 租户以及有自定义 MCP 权限的 ChatGPT 工作区。以下操作在浏览器中即可完成。把云端生成的真实域名记作 **服务域名**；OAuth 的资源标识为该域名的 HTTPS 地址加 `/mcp`。示例配置中的 .invalid 仅为占位符。

## 1. Railway 与 PostgreSQL

1. 登录 Railway，创建空项目，添加 PostgreSQL。确认数据库挂载持久卷。仅让服务通过私网连接数据库，关闭不需要的公共 TCP 代理。
2. 添加 GitHub Repo 服务，授权指定私有仓库，选择 main 分支。Dockerfile 在仓库根目录。服务命名为 web，启用 GitHub 自动部署与常驻运行，关闭 Serverless/App Sleeping，先使用一个副本。
3. 在 web 的 Settings → Networking 选择 Generate Domain，容器目标端口设为 3000，变量 PORT 同样设为 3000。记录生成的 HTTPS 域名。Healthcheck Path 设为 /health。首次缺少配置时容器会退出，配置好后重新部署。
4. Variables 中创建 DATABASE_URL，选择对 PostgreSQL 服务私网 DATABASE_URL 的引用，无需复制数据库密码。设置 PUBLIC_ORIGIN 为服务的 HTTPS origin（无路径），TZ 为 Asia/Shanghai，SCHEDULER_ENABLED 为 true。完成下一节后再填 OAUTH_ISSUER、ALLOWED_SUBJECTS、WEB_CLIENT_ID。
5. 数据库用户最少需要本库的 CONNECT 和应用 schema 的建表、读写、序列权限。专用数据库和专用角色仅限此项目。检查角色没有集群管理员、创建其他数据库或复制权限；如使用托管模板初始管理员，为应用另建角色并使用其私网连接。公网数据库连接使用提供方 CA 和 verify-full。避免复制带禁用证书验证选项的连接串。

仓库同时给出 Railway IaC 声明 .railway/railway.ts，适用于平台的 IaC 工作流。纯网页方式按上述设置即可，保留型环境变量需在 Railway 中填写。应用启动时迁移及调度，无须另建 cron 服务。[Railway IaC](https://docs.railway.com/infrastructure-as-code/reference) · [GitHub 自动部署](https://docs.railway.com/deployments/github-autodeploys)

## 2. Auth0 配置

1. 在 Auth0 Dashboard 建立 API，Identifier 精确填写真实 HTTPS MCP URL，含 /mcp、无结尾斜线，算法 RS256。添加 portfolio:read、portfolio:write 两项 API Permissions。启用 API 的 Allow Offline Access（需要持续连接时）。
2. 在 Tenant Settings → Advanced 启用 **Resource Parameter Compatibility Profile**，让授权请求中的 resource 选中同一个 API。使用租户默认域名或已正确配置的自定义域名，保持 discovery、令牌的 iss 和 OAUTH_ISSUER 一致。
3. 创建供 ChatGPT 使用的 **Regular Web Application**（静态 OAuth 客户端）。允许 Authorization Code、需要时允许 Refresh Token，支持 PKCE S256。采用与 ChatGPT 兼容的 token endpoint 认证方式。在 ChatGPT 的 MCP 管理界面复制该连接显示的**完整回调 URI**，原样加入此客户端的 Allowed Callback URLs。如果界面需先填写基本信息，回到此步补全后重试 OAuth。把该客户端的 ID 和 Secret 填在 ChatGPT 的连接配置中。
4. 为 /manage 单独创建 **Single Page Application**，Token Endpoint Authentication Method 选择 None。其 Allowed Callback URLs 和 Allowed Logout URLs 均为服务 HTTPS origin 加 /manage；Allowed Web Origins 为服务 HTTPS origin。把这个 SPA 的公开 Client ID 写入 Railway 的 WEB_CLIENT_ID。SPA 使用授权码及 PKCE，不需要客户端 Secret。
5. 在 User Management 创建/选择本人身份，启用与上述两个应用匹配的登录连接。复制用户的 **user_id**（例如形似 auth0|…），填写到 Railway 的 ALLOWED_SUBJECTS；多个用户用英文逗号隔开。OAUTH_ISSUER 填签发者 HTTPS 根地址。启用 API RBAC 时，将 read/write 权限通过角色分配给本人，查询账号可仅分配 read。使用稳定的身份连接，删除重建身份或更换租户会改变账本归属。
6. 重新部署 web。用浏览器打开 /health，预期返回 status 为 ok。无 Authorization 直接打开 /mcp，预期 401。打开 /.well-known/oauth-protected-resource/mcp，确认 resource 与 API Identifier 完全一致。在 /manage 登录并用虚构持仓验证录入、预览及删除。再接入真实账户数据。[Auth0 对 resource 的说明](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0) · [OpenAI OAuth 要求](https://developers.openai.com/plugins/build/auth)

## 3. ChatGPT 网页版

在 Plugins（插件）页面选择加号 → Add custom MCP server。旧版界面在 Settings 或 Workspace Settings → Apps → Create。填入真实 HTTPS /mcp 地址，选择 OAuth，填第 2 节配置的 ChatGPT 客户端凭据，完成授权并扫描工具。在对话中选择该插件或 @ 它，先查询“列出我的持仓并显示净值日期”，再用另一会话核对。不要把 OAuth Secret 或访问令牌作为聊天消息发送。更改工具清单后在管理页刷新，已发布工作区可能需要管理员批准更新。

OpenAI 当前说明允许普通自定义服务器自定义工具，search/fetch 非必需；本项目另外提供这对只读接口，以适配检索场景。Business、Enterprise/Edu 的完整 MCP 能力受管理员、工作区和权限控制；Pro 的自定义 MCP 权限以读取/获取为限。若 ChatGPT 仅能读，用 /manage 在浏览器录入，两端登录同一 Auth0 身份。[ChatGPT 接入指南](https://developers.openai.com/api/docs/guides/custom-mcp-server) · [工作区与套餐说明](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

## 4. 定时更新、监控及验收

常驻 web 进程每分钟查看上海时区的最近调度窗口。21:10 同步当天，23:10 再检查，次日 08:10 复查前一天。每个窗口最多执行 3 次系统故障重试，间隔至少 15 分钟。成功但未披露的基金标为 awaiting_nav，在后续窗口或手动刷新时复查。任务不依赖聊天会话。进程重启会检查最近窗口，较长停机由后续历史回补覆盖。未实现 ChatGPT 定时主动推送。

需要独立调度时，可关闭内置 SCHEDULER_ENABLED 并令同镜像的短任务执行 node src/worker.js；UTC cron 为 `10 0,13,15 * * *`。数据库连接必须相同，短任务无需对外域名。保持单一主要调度方式。刷新会抓取最近 32 个日历日，再向前补最多 90 天；手动 refresh_portfolio 可指定不超过约一年的闭区间并分段回补。

上线后按顺序检查 /health、匿名 /mcp、OAuth 登录、工具发现、写入临时测试仓位、刷新、跨会话读取、服务重新部署后读取、清理临时记录。使用 get_last_sync_time、get_data_status、get_sync_errors 及 Railway Deployment Logs 检查 21:10 和次晨窗口。成功的健康检查只证明数据库可达。要检测出站行情访问，可在云端 Shell 执行 node scripts/probe.js（镜像含该探针），或在 ChatGPT 调用 get_fund_nav_history 查询公开基金 110011 的 2025-01-02 至 2025-01-10。生产验收时应从实际区域执行。

| 现象 | 处理 |
| --- | --- |
| 401 或重复登录 | 核对 issuer、系统时间、API Identifier、resource compatibility、回调 URI、refresh token 设置 |
| 403 或读得出写不入 | 检查具体 Auth0 user_id、租户、scope、API 角色和 ChatGPT 工作区权限 |
| 健康检查失败 | 看变量是否齐全，核对私网连接、schema 写入权限、持久卷和迁移校验和 |
| 净值日期落后 | 查看数据源最后披露日，区分 QDII、节假日和 source_error；可在稍后窗口手动回补 |
| 网页可查，ChatGPT 为空 | 对比两端实际 IdP 身份；同一个邮箱通过不同登录连接可能得到不同 sub |
| 出站接口 429、超时或失效 | 保留已有持仓及净值，查看同步错误，稍后重试。连续失败更换允许访问的区域或修复供应方字段；勿填估值替代正式净值 |

## 5. 成本、备份和备选平台

Railway Hobby 标价每月 5 美元，含 5 美元用量；小型单用户常驻 Node 服务加 PostgreSQL，初始预算可按 **约 5–15 美元/月** 估算，实际取决于内存、卷、网络、区域与税费。这是预算估算。Auth0、备份存储和 ChatGPT 订阅另计，核对各自套餐。建议在平台设置用量提醒。[Railway 价格](https://railway.com/pricing)

在数据库卷的 Backups 页面查看本套餐能否设置自动备份、保留期及恢复，启用适用能力；另将逻辑备份保存到限制访问且加密的独立存储。浏览器可在已授权的云 Shell / Codespace 运行仓库 scripts/backup.sh 与 scripts/restore.sh，需安装与数据库同代或更新的 PostgreSQL 客户端，并有该数据库网络通路。Railway 私网请在项目内运维容器运行。把数据库 URL 设为该运维服务的 Secret；不要把备份传入 GitHub。

```sh
# 在有持久安全备份目录的云运维容器运行
sh scripts/backup.sh /secure-backup/fund-ledger.dump
# RESTORE_DATABASE_URL 指向新建空库，先演练后再切换服务变量
sh scripts/restore.sh /secure-backup/fund-ledger.dump
```

恢复脚本拒绝非空目标，并在单个事务内恢复。恢复后核对迁移数、用户数、交易行数和样本快照，再切换 DATABASE_URL。删除原库或移动生产卷需单独操作。export_portfolio 为单个用户的持仓/流水导出；数据库全量备份另含净值、迁移和调度状态。

Render 可在 Dashboard → New Blueprint 连接同一私有仓库，使用 render.yaml 创建付费常驻 web 服务与持久化数据库，补齐 OAuth 和域名变量。Render 配置为备选，尚未在真实租户验收。
