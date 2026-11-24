# MCP 工具与参数

详细字段、必填项、枚举、上限和工具注解见 [完整可机读目录](tools.json)，在仓库运行 npm run tools 可重新生成。所有结果以 MCP text 内容中的 JSON 返回，并附 structuredContent.result。普通错误返回 isError；字段错误携带 fields/path，业务错误携带中文说明。HTTP 未认证为 401，无权限为 403 或工具级 insufficient_scope。管理接口使用 POST /api/tools/工具名、相同 JSON 参数及 Bearer 令牌。

| 工具 | 参数与返回 |
| --- | --- |
| search_funds | keyword → 公开目录候选 |
| get_fund_info / get_fund_nav / get_fund_estimate / get_fund_stock_holdings | code → 档案、最近披露净值、盘中估值或持股报告 |
| get_fund_nav_history | code, start, end → 披露日、单位净值及公司行动；最多 90 天 |
| get_fund_performance | code, range → 基金、基准及同类历史表现 |
| get_market_overview / get_stock_quote | 空对象或 ids 数组 → 指数与证券公开行情 |
| get_portfolio / get_daily_profit | 可选 day → 组合及逐平台、逐基金盈亏，附日期与缺失状态 |
| get_holding | code，可选 day、platform → 指定基金分平台记录和合计 |
| add_holding / update_holding | holding → 创建期初记录或生成更正预览 |
| import_holdings | data.rows 或 data.csv → 原子导入预览 |
| record_transaction | transaction，可选分红除息日 exDay → 已记账 ID，或幂等重放结果 |
| get_transactions | 可选 platform、code、kind、status、offset、limit → 筛选后的分页流水和总数，转换支持按转入或转出代码查询 |
| preview_portfolio_changes | operation.action 及对应参数 → 待改行、已有行、token、有效期 |
| delete_transaction / delete_holding | id，或 platform 与 code → 删除预览 |
| confirm_changes | token → 确认当次预览、返回受影响 ID |
| export_portfolio | 空对象 → schemaVersion、exportedAt、portfolio、events |
| get_portfolio_summary | 可选 day → 总览，附近七天、本月、本年统计 |
| get_profit_history | start, end → 资产与盈亏曲线 |
| get_monthly_profit / get_yearly_profit | 可选 day → 截至该日的月度/年度收益 |
| get_portfolio_performance / get_max_drawdown / get_xirr | start, end → 同一套区间指标，附覆盖期、TWR、回撤与 XIRR |
| get_asset_allocation | 可选 day、group（code/platform/category）→ 组内市值和占比 |
| refresh_portfolio | 可选 start/end → 回补或刷新结果及逐基金同步状态 |
| get_data_status / get_last_sync_time / get_sync_errors | 空对象 → 用户范围的同步记录 |
| search / fetch | query → results 列表；id → 可引用持仓文档，仅本人可读 |

查询与公开行情均要求 portfolio:read，所有写工具另要求 portfolio:write。预览会在数据库暂存确认凭据也视为写工具。确认操作带 destructiveHint；市场/远程净值查询带 openWorldHint。管理网页同样展示、确认同一份预览。普通单行新增和记账支持直接校验写入；ChatGPT 是否显示每次工具确认取决于工作区设置。
