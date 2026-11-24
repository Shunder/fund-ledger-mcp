# 架构、数据模型与安全

## 上游调研

基线为 smallke/cn-funds-mcp 的 bb44fbc。源码为 Node.js ESM，bin 指向 src/index.js，唯一声明的依赖是 @modelcontextprotocol/sdk ^1.12.1，没有锁文件，无法还原作者当时机器上实际安装的小版本。入口用 McpServer 与 StdioServerTransport，直接导入传递依赖 zod。上游注册 24 个工具，覆盖基金目录、估值、批量资料、经理与持仓、股票指数和资金流向、本地持仓及提醒。持仓和提醒分别写入 data 下的 JSON；提醒需在会话中轮询。原盈亏算法以估值乘份额，并用 JavaScript Number 计算。[固定版本源码](https://github.com/smallke/cn-funds-mcp/tree/bb44fbc653bb068f0cacd588f19aed0249bffc3d)

本版显式锁定 SDK 1.32.2 及 zod。复用 src/api.js 的行情映射，新增请求超时、响应体上限、禁止跳转。正式净值取天天基金历史明细的 FSRQ/DWJZ。分页核对日期、单位净值类型、唯一日期与总数。该数据由第三方转引基金披露，可能延迟或订正。估值接口仅供单独查询。经理、资金流等适配函数仍在源码，可用于后续扩展。旧版工具名与不安全的本地持仓写入接口没有全部映射到新版。[上游字段对照](UPSTREAM.md)

## 核心模块

| 模块 | 职责 |
| --- | --- |
| src/index.js、http.js | 原生 SDK 的无状态 Streamable HTTP /mcp，stdio，OAuth 资源服务器，浏览器受保护 API |
| src/tools.js、public/ | 同一工具目录和 Zod 校验器供 MCP 与管理页调用 |
| src/model.js、book.js | 期初估算、确认流水校验、移动平均成本、转换双腿及历史回放 |
| src/analytics.js | 汇总日、净值日期、现金流调整、收益曲线、TWR、回撤与 XIRR |
| src/store.js、db.js | 参数化 SQL、租户范围、预览、确认、幂等及迁移 |
| src/source.js、sync.js、schedule.js | 分页披露净值、缓存覆盖区间、回补、快照、上海时区调度 |

## PostgreSQL

脚本在 migrations/。schema_migrations 保存版本与 SHA-256，迁移串行、事务化。ledger_users 的 owner 为签发者与 OAuth sub 的哈希；外部工具无法传入 owner。ledger_events 的主键为 (owner,id)，按确认日、同日登记顺序回放，每条记录有创建和修改时间。平台加六位基金代码唯一标识一个仓位。平台标签与流水一起保存，当前持仓计算得出。转换的出入腿保存在同一条流水中。手工清仓使用真实赎回流水，继续保留历史。

funds 保存公共档案。fund_nav_history 按代码、净值日期唯一，保留更正后的值、公司行动提示和入库更新时间。nav_coverage 标记查询成功的日期区间。daily_snapshots 按 owner 与日期唯一，记录快照与账本版本。写交易会使旧快照失效，实时查询用一致性快照回放；下一次同步重建。sync_logs 保存该用户的同步状态和检查时间。schedule_runs 对上海时间窗口去重。previews 保存有期限的操作、版本与结果，成功确认可安全重试。

写入在同一用户行锁内校验整个账本。历史补录或删错行导致后续份额不足时会整笔回滚。预览只有发起人能确认；期间发生其他修改须重新预览。共享公开净值和租户私有账本分表，应用层对所有私有查询绑定 owner。数据库运行角色仍能访问账本，不应作为外部客户端凭证分发。个人部署应仅向受信任管理者开放数据库和 Railway 项目。

## 认证与传输

固定 HTTPS issuer、固定 JWKS 路径，jose 校验 RS256 签名、iss、aud、sub、iat 和 exp。必须命中 ALLOWED_SUBJECTS。portfolio:read 用于查询；写入同时需要 portfolio:write。端点先鉴权，再接受 MCP 初始化和工具调用。401 返回受保护资源元数据；工具声明权限范围、readOnlyHint、destructiveHint、openWorldHint 和幂等性。授权码、用户登录、PKCE、刷新令牌及撤销由 Auth0 负责。客户端 Secret 仅保存在 ChatGPT 与身份提供方。浏览器使用独立公开 SPA 客户端和内存令牌。

所有查询参数均被 /mcp 和 /api 拒绝。服务端只允许固定行情主机与配置的签发者；基金代码按六位数字校验。管理页使用固定静态目录、同源请求、CSP、textContent 和 Bearer 头。服务使用非 root 镜像，输入体上限 128 KiB、上游请求 8 秒、数据库语句 30 秒；每分钟按连接来源粗限 480 次、按用户限 90 次。反向代理可能共用外层额度，此配置适合个人单实例。默认不信任任意转发头。应用日志仅输出通用启动/调度状态。云平台或 IdP 的日志保留策略需由租户管理员配置。

## 数据边界

运营者可访问托管数据库。持仓或流水工具的返回会交给所选 ChatGPT 工作区。行情供应方会收到查询的基金代码、日期或搜索词；不会收到平台名称、份额、账户身份或成交金额。私有交易数据只存于 PostgreSQL；用户主动导出的文件和备份需单独保管。上游 JSON 迁移请在 /manage 录入真实平台与原始快照日期，并预览导入。没有可靠基准日期的数据无法自动迁移。
