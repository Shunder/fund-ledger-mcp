# 基金账本的零费用部署

适合已有相应 ChatGPT 权限、能接受冷启动和延迟的个人用户。Web 服务、数据库与自动同步分别使用免费额度。额度耗尽时接受暂停服务；不要启用付费升级。仓库自带的常驻 Railway IaC 和 Render Blueprint 面向其他部署方式。

| 服务 | 配置 | 额度与取舍 |
| --- | --- | --- |
| Railway Free | 一个可休眠的 Web 服务 | 每月 1 美元资源抵扣，用完暂停。Free 不提供常驻实例和平台 cron。过期试用需先在工作区选择 Free。 |
| Neon Free | 一个 PostgreSQL 数据库 | 免费额度内持久化，空闲时计算休眠。数据库与 Web 可独立唤醒。 |
| GitHub Actions | 私有仓库的标准 Linux runner | 定时任务可能延迟。免费分钟与账号其他仓库共享，调度默认为关闭。 |
| Auth0 | Free 租户，Web 与 SPA 客户端 | 单人登录按免费套餐的可用功能配置。 |
| ChatGPT | 使用账号已有的自定义 MCP 权限 | 服务器免费与 ChatGPT 套餐分开。Pro 读工具、完整读写等权限取决于工作区。 |

[Railway Free](https://docs.railway.com/pricing/free-plan) · [Neon 定价](https://neon.com/pricing) · [Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Auth0 定价](https://auth0.com/pricing) · [ChatGPT 权限](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

## 网页设置

1. Railway 工作区选择 **Free**。如果旧工作区试用到期且无法选择 Free，先停在套餐页面。创建项目 fund-ledger-mcp，添加一个连接本仓库 main 分支的 Web 服务，使用 Dockerfile、3000 端口和 /health。允许休眠，设置 SCHEDULER_ENABLED=false。避免高频外部保活。
2. 在 Neon 建立 Free 项目。使用直连 PostgreSQL 字符串（主机名不含 -pooler），启用 TLS 并校验证书，可使用 sslmode=verify-full。这个项目用 PostgreSQL 会话级 advisory lock 调度，事务池模式不适用。将连接串存入 Railway 的 DATABASE_URL，使用独立数据库，避免在聊天或 Git 中传递凭据。
3. 生成 Railway 服务域名。按[部署指南的 Auth0 和 ChatGPT 章节](DEPLOY.md)填写 OAuth issuer、用户白名单、浏览器 client ID 和对外 origin。使用实际 HTTPS 域名加 /mcp 注册资源。部署后检查 /health、匿名 /mcp 的 401、真实 OAuth 登录，以及休眠后第一次工具发现能否成功。若首次请求超时，唤醒后重试。
4. 在 GitHub 账户 Billing 确认标准 Linux runner 的剩余免费额度。有支付方式时，为 Actions 配置阻止额外用量的零付费预算，并启用 **Stop usage when budget limit is reached**；如果账户无法限制超额扣费，保持自动任务关闭。在仓库 Settings → Secrets and variables → Actions，将同一数据库直连串保存为 Secret FUND_SYNC_DATABASE_URL，再新建仓库 Variable ENABLE_FREE_SYNC=true。仅在可信的默认分支运行。
5. 在仓库 Actions → Sync disclosed fund NAVs 手动运行一次，核对成功状态，再在 MCP 中查询 get_last_sync_time。之后每天上海时间 08:10、21:10、23:10 启动 runner。早间窗口复查前一天。任务直接连接数据库，Web 服务休眠也能回补。每次最多运行 10 分钟，31 天的定时作业按每次用满计算约 930 分钟，手动执行、普通 CI 及其他仓库另计。修改 ENABLE_FREE_SYNC=false 可停止后续同步作业。

真实的免费可用性取决于存储增长、行情源、账单限制和调用频率。频繁唤醒可能耗尽 Web 额度。CI 或定时运行不会向聊天自动推送消息。数据库恢复仍需独立备份；可使用仓库的备份脚本，收费备份服务需要另行选择。
