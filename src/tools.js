import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "./api.js";
import {
  code,
  date,
  D,
  money,
  pct,
  opening,
  transaction,
  key,
  label,
  today,
  shift,
  requireValue,
  InputError,
} from "./model.js";
import {
  operation,
  importInput,
  edit,
  confirm,
  eventsFor,
  readInputs,
} from "./store.js";
import { performance, project } from "./analytics.js";
import { refresh } from "./sync.js";
import { officialHistory } from "./source.js";

const tools = [];
function tool(name, description, shape, run, flags = {}) {
  tools.push({
    name,
    description,
    schema: z.object(shape).strict(),
    run,
    write: false,
    destructive: false,
    open: false,
    idempotent: true,
    ...flags,
  });
}
const byCode = { code },
  asOf = { day: date.optional().describe("净值对应日期，默认上海今天") };
const range = { start: date, end: date };
const write = { write: true },
  preview = { write: true, idempotent: false };
const delPreview = { ...preview, destructive: false };
const market = { open: true };
const marketRange = z
  .enum(["m", "q", "hy", "y", "2y", "3y", "5y"])
  .default("y");
function checkRange(start, end, days = 366) {
  requireValue(
    start <= end && shift(start, days) >= end,
    "日期区间倒置或超出请求上限",
  );
}
async function report(ctx, day = today(), extra = []) {
  const d = await readInputs(ctx.pool, ctx.owner);
  return project(d.events, d.quotes, d.coverage, day, extra, d.funds);
}
function emptyReport(day) {
  return {
    day,
    status: "no_confirmed_holdings",
    fundCount: 0,
    holdings: [],
    dailyProfit: null,
    cumulativeProfit: null,
    marketValue: null,
    navDates: [],
    dataUpdatedAt: null,
  };
}
async function current(ctx, day = today()) {
  return (await report(ctx, day)).at(-1)?.report || emptyReport(day);
}
function wrapMarket(kind, fn) {
  return async (ctx, args) => ({
    kind,
    source: "东方财富 / 天天基金",
    retrievedAt: new Date().toISOString(),
    result: await fn(args),
  });
}
tool(
  "search_funds",
  "按代码、简称或拼音检索公开基金。重名时请用户选择确切代码。",
  { keyword: label },
  wrapMarket("fund_directory", (a) => api.searchFund(a.keyword)),
  market,
);
tool(
  "get_fund_info",
  "公开基金档案、披露净值日期、基金类型及经理。",
  byCode,
  wrapMarket("fund_profile", (a) => api.getFundInfo(a.code)),
  market,
);
tool(
  "get_fund_estimate",
  "查询盘中估值，严禁用于已实现或正式每日收益。",
  byCode,
  wrapMarket("intraday_estimate", (a) => api.getFundEstimate(a.code)),
  market,
);
tool(
  "get_fund_nav_history",
  "查询指定期间单位净值，最多 90 天。",
  { ...byCode, ...range },
  wrapMarket("published_unit_nav", (a) => {
    checkRange(a.start, a.end, 89);
    return officialHistory(a.code, a.start, a.end);
  }),
  market,
);
tool(
  "get_fund_nav",
  "最近 90 天内最后一个披露的单位净值，附净值日期。",
  byCode,
  wrapMarket(
    "published_unit_nav",
    async (a) =>
      (await officialHistory(a.code, shift(today(), -89), today())).sort(
        (a, b) => b.day.localeCompare(a.day),
      )[0] ?? null,
  ),
  market,
);
tool(
  "get_fund_performance",
  "基金公开业绩及指数比较，区别于个人投资收益。",
  { ...byCode, range: marketRange },
  wrapMarket("fund_performance", (a) =>
    api.getFundAccumulatedPerformance(a.code, a.range),
  ),
  market,
);
tool(
  "get_fund_stock_holdings",
  "基金定期披露的重仓股。",
  byCode,
  wrapMarket("disclosed_positions", (a) => api.getFundPosition(a.code)),
  market,
);
tool(
  "get_market_overview",
  "沪深市场概览。",
  {},
  wrapMarket("market_quote", () => api.getMarketOverview()),
  market,
);
tool(
  "get_stock_quote",
  "查询指定市场指数/股票报价，证券 ID 取决于数据源覆盖。",
  {
    ids: z
      .array(z.string().regex(/^\d{1,3}\.[A-Za-z0-9]{1,12}$/))
      .min(1)
      .max(20),
  },
  wrapMarket("market_quote", (a) => api.getStockQuote(a.ids)),
  market,
);
tool(
  "add_holding",
  "新增一个平台的人民币基金期初快照。必须有基准日期。只记录真实持仓。",
  { holding: opening },
  (c, a) => edit(c.pool, c.owner, { action: "add", ...a }),
  { ...write, open: true },
);
tool(
  "record_transaction",
  "记录已发生交易，幂等 ID 在重试和 pending 转 confirmed 时保持相同。申购 amount 含费，赎回 amount 为实收；转换 amount 为转出毛额。仅记账。",
  { transaction },
  (c, a) => edit(c.pool, c.owner, { action: "record", ...a }),
  write,
);
tool(
  "preview_portfolio_changes",
  "预览行级变化并签发十分钟确认凭据。向用户展示，获得同意后调用 confirm_changes。",
  { operation },
  (c, a) => edit(c.pool, c.owner, a.operation, true),
  { ...preview, open: true },
);
tool(
  "update_holding",
  "更正已有期初快照，先返回待确认的预览。",
  { holding: opening },
  (c, a) => edit(c.pool, c.owner, { action: "update", ...a }, true),
  { ...preview, open: true },
);
tool(
  "import_holdings",
  "预览 JSON 行数组或带表头的 CSV。确认后整批提交。",
  { data: importInput },
  (c, a) => edit(c.pool, c.owner, { action: "import", ...a }, true),
  { ...preview, open: true },
);
tool(
  "delete_holding",
  "预览删除指定平台基金的全部流水；实际清仓请记录赎回。",
  { platform: label, code },
  (c, a) => edit(c.pool, c.owner, { action: "delete_holding", ...a }, true),
  delPreview,
);
tool(
  "delete_transaction",
  "预览移除错误流水，对剩余历史回放校验。",
  { id: key },
  (c, a) => edit(c.pool, c.owner, { action: "delete_record", ...a }, true),
  delPreview,
);
tool(
  "confirm_changes",
  "仅在用户对预览明确同意后提交。匹配用户、版本和有效期。",
  { token: z.string().uuid() },
  (c, a) => confirm(c.pool, c.owner, a.token),
  { write: true, destructive: true },
);
tool(
  "get_portfolio",
  "按平台返回全部持仓，附来源日期和估算依据。",
  asOf,
  (c, a) => current(c, a.day),
);
tool(
  "get_holding",
  "查询指定基金的分平台持仓与合并市值。",
  { ...byCode, ...asOf, platform: label.optional() },
  async (c, a) => {
    const r = await current(c, a.day),
      holdings = r.holdings.filter(
        (i) => i.code === a.code && (!a.platform || a.platform === i.platform),
      );
    const values = holdings.map((i) =>
      D(i.shares).isZero()
        ? "0"
        : i.marketValue !== null && i.nav
          ? D(i.shares).times(i.nav)
          : null,
    );
    return {
      day: r.day,
      holdings,
      combinedShares: holdings
        .reduce((s, i) => s.plus(i.shares), D(0))
        .toFixed(),
      combinedMarketValue: values.every((v) => v != null)
        ? money(values.reduce((s, v) => s.plus(v), D(0)))
        : null,
    };
  },
);
tool(
  "get_transactions",
  "获取流水、状态及原始输入，按登记顺序分页，可按平台、交易类型、状态及基金筛选。",
  {
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(100),
    code: code.optional(),
    platform: label.optional(),
    kind: z.enum(["opening", ...transaction.shape.kind.options]).optional(),
    status: transaction.shape.status.unwrap().optional(),
  },
  async (c, a) => {
    const all = (await eventsFor(c.pool, c.owner)).filter(
      (e) =>
        (!a.code || e.code === a.code || e.targetCode === a.code) &&
        (!a.platform || e.platform === a.platform) &&
        (!a.kind || e.kind === a.kind) &&
        (!a.status || e.status === a.status),
    );
    return {
      total: all.length,
      items: all.slice(a.offset, a.offset + a.limit),
    };
  },
);
tool(
  "export_portfolio",
  "导出账户范围内结构化持仓和完整历史流水（JSON）。",
  {},
  async (c) => {
    const d = await readInputs(c.pool, c.owner);
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      portfolio:
        project(d.events, d.quotes, d.coverage, today(), [], d.funds).at(-1)
          ?.report ?? emptyReport(today()),
      events: d.events,
    };
  },
);
tool(
  "get_daily_profit",
  "指定净值日逐基金和组合收益。未知为 null；knownDailySubtotal 仅为已披露小计。",
  asOf,
  (c, a) => current(c, a.day),
);
tool(
  "get_portfolio_summary",
  "当前市值、已实现、未实现、累计收益及最近一周、本月、本年区间收益。",
  asOf,
  async (c, a) => {
    const end = a.day || today(),
      starts = {
        week: shift(end, -6),
        month: end.slice(0, 7) + "-01",
        year: end.slice(0, 4) + "-01-01",
      };
    const series = await report(
      c,
      end,
      Object.values(starts).map((d) => shift(d, -1)),
    );
    return {
      ...(series.at(-1)?.report || emptyReport(end)),
      periods: Object.fromEntries(
        Object.entries(starts).map(([k, s]) => [
          k,
          performance(series, s, end),
        ]),
      ),
    };
  },
);
tool(
  "get_profit_history",
  "返回净值/交易日期的资产曲线与收益，最多 366 天，保留缺失。",
  range,
  async (c, a) => {
    checkRange(a.start, a.end);
    return (await report(c, a.end))
      .filter((r) => r.day >= a.start)
      .map(({ report: { holdings, ...point } }) => point);
  },
);
async function metrics(c, a) {
  checkRange(a.start, a.end, 3660);
  return performance(
    await report(c, a.end, [shift(a.start, -1)]),
    a.start,
    a.end,
  );
}
for (const [name, desc] of [
  ["get_portfolio_performance", "区间资金流调整收益及 TWR"],
  ["get_max_drawdown", "区间净值化财富指数的最大回撤"],
  ["get_xirr", "区间 XIRR（约定现金流有唯一根时）"],
])
  tool(name, desc, range, metrics);
tool(
  "get_monthly_profit",
  "指定日期所在月份，从月初到该日的收益。",
  asOf,
  (c, a) => {
    const end = a.day || today();
    return metrics(c, { start: end.slice(0, 7) + "-01", end });
  },
);
tool(
  "get_yearly_profit",
  "指定日期所在年份，从年初到该日的收益。",
  asOf,
  (c, a) => {
    const end = a.day || today();
    return metrics(c, { start: end.slice(0, 4) + "-01-01", end });
  },
);
tool(
  "get_asset_allocation",
  "按平台、基金代码或类别归集最新可得市值。",
  { group: z.enum(["platform", "code", "category"]).default("code"), ...asOf },
  async (c, a) => {
    const r = await current(c, a.day),
      groups = new Map();
    for (const i of r.holdings) {
      if (!D(i.shares).gt(0)) continue;
      const k = i[a.group] || "未分类",
        old = groups.has(k) ? groups.get(k) : D(0);
      groups.set(
        k,
        i.marketValue == null || old == null
          ? null
          : old.plus(D(i.shares).times(i.nav)),
      );
    }
    const total = [...groups.values()].some((v) => v == null)
      ? null
      : [...groups.values()].reduce((a, v) => a.plus(v), D(0));
    return {
      day: r.day,
      navDates: r.navDates,
      dataUpdatedAt: r.dataUpdatedAt,
      items: [...groups].map(([name, v]) => ({
        name,
        value: money(v),
        weightPct: pct(v != null && total?.gt(0) ? v.div(total) : null),
      })),
    };
  },
);
tool(
  "refresh_portfolio",
  "同步披露单位净值并生成快照，可指定最多 366 天回补。",
  { start: date.optional(), end: date.optional() },
  (c, a) => {
    if (a.start) checkRange(a.start, a.end || today());
    return refresh(c.pool, c.owner, a, c.navSource);
  },
  { write: true, open: true },
);
for (const [name, filter, limit] of [
  ["get_data_status", "", 50],
  ["get_last_sync_time", "", 1],
  ["get_sync_errors", " AND status='source_error'", 50],
]) {
  tool(
    name,
    "用户所属净值同步状态、目标日期、基金代码与检查时间。",
    {},
    async (c) => ({
      items: (
        await c.pool.query(
          "SELECT day,status,code,updated_at FROM sync_logs WHERE owner=$1" +
            filter +
            " ORDER BY id DESC LIMIT $2",
          [c.owner, limit],
        )
      ).rows,
    }),
  );
}
tool(
  "search",
  "在已认证用户持仓中检索基金代码、名称或平台，供检索型客户端使用。",
  { query: z.string().trim().min(1).max(100) },
  async (c, a) => {
    const r = await current(c),
      codes = new Map();
    for (const h of r.holdings)
      if ([h.code, h.name, h.platform].some((s) => s?.includes(a.query)))
        codes.set(h.code, {
          id: h.code,
          title: h.name || h.code,
          url: c.origin + "/manage#fund-" + h.code,
        });
    return { results: [...codes.values()] };
  },
);
tool(
  "fetch",
  "获取当前用户名下一个基金文档，id 来自 search。",
  { id: code },
  async (c, a) => {
    const r = await current(c),
      holdings = r.holdings.filter((h) => h.code === a.id);
    requireValue(holdings.length, "未找到持仓文档");
    return {
      id: a.id,
      title: holdings[0].name || a.id,
      text: JSON.stringify({ day: r.day, holdings }),
      url: c.origin + "/manage#fund-" + a.id,
      metadata: { source: "个人账本" },
    };
  },
);
export const catalog = tools;
export function publicError(e) {
  if (e instanceof z.ZodError)
    return {
      code: "INVALID_INPUT",
      fields: e.issues.map((i) => ({ path: i.path.join("."), reason: i.code })),
    };
  if (e instanceof InputError)
    return {
      code: "INVALID_REQUEST",
      message: e.message,
      missingFields: e.missingFields,
    };
  return { code: "UNAVAILABLE", message: "服务或数据源暂不可用，请稍后重试。" };
}
export function mcpServer(
  ctx,
  { enabledTools = tools, instructions, stdio = false } = {},
) {
  const server = new McpServer(
    {
      name: "fund-ledger-mcp",
      title: "基金账本",
      version: "1.0.0",
    },
    { instructions },
  );
  for (const t of enabledTools) {
    const scope = t.write ? "portfolio:write" : "portfolio:read";
    const requiredScopes = t.write
      ? ["portfolio:read", "portfolio:write"]
      : ["portfolio:read"];
    const schemes = stdio
      ? [{ type: "noauth" }]
      : [{ type: "oauth2", scopes: requiredScopes }];
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.schema,
        outputSchema: {
          result: z.union([
            z.record(z.string(), z.unknown()),
            z.array(z.unknown()),
            z.null(),
          ]),
        },
        annotations: {
          readOnlyHint: !t.write,
          destructiveHint: t.destructive,
          idempotentHint: t.idempotent,
          openWorldHint: t.open,
        },
        _meta: { securitySchemes: schemes },
      },
      async (args) => {
        if (!requiredScopes.every((s) => ctx.scopes.includes(s)))
          return {
            isError: true,
            content: [{ type: "text", text: "权限不足 " + scope }],
            _meta: {
              "mcp/www_authenticate": [
                'Bearer error="insufficient_scope", scope="' +
                  requiredScopes.join(" ") +
                  '", resource_metadata="' +
                  ctx.metadata +
                  '"',
              ],
            },
          };
        try {
          const data = await t.run(ctx, t.schema.parse(args));
          return {
            structuredContent: { result: data },
            content: [{ type: "text", text: JSON.stringify(data) }],
          };
        } catch (e) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(publicError(e)) }],
          };
        }
      },
    );
  }
  return server;
}
