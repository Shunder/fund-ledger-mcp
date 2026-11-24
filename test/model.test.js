import test from "node:test";
import assert from "node:assert/strict";
import { D, snapshot, validateTrade } from "../src/model.js";
import { project, performance, xirr } from "../src/analytics.js";
import { validateBook } from "../src/book.js";
import { officialHistory } from "../src/source.js";
import { fetchText } from "../src/api.js";
import http from "node:http";

const base = {
  platform: "演示平台",
  code: "000001",
  day: "2025-01-02",
  shares: "100",
  cost: "100",
};
const open = snapshot(base);
const quotes = ["1", "1.1", "0.99"].map((nav, i) => ({
  code: base.code,
  day: ["2025-01-02", "2025-01-03", "2025-01-06"][i],
  nav,
  updated_at: "2025-01-07T01:02:03Z",
}));
const coverage = [
  { code: base.code, start_day: "2024-12-01", end_day: "2025-01-31" },
];
const calc = (
  events = [open],
  prices = quotes,
  end = "2025-01-06",
  cov = coverage,
) => project(events, prices, cov, end);
function trade(kind, more = {}) {
  return validateTrade({
    kind,
    code: base.code,
    platform: base.platform,
    id: "synthetic",
    day: "2025-01-03",
    orderDay: "2025-01-02",
    amount: "11",
    nav: "1.1",
    shares: "10",
    ...more,
  });
}
test("decimal derivation is dated and traceable; insufficient or inconsistent snapshot rejected", () => {
  const r = snapshot({
    platform: "示例",
    code: "000001",
    day: base.day,
    marketValue: "600",
    unitCost: "2",
    returnPct: "-25",
  });
  assert.equal(r.shares, "400");
  assert.equal(r.cost, "800");
  assert.equal(r.basisDay, base.day);
  assert.equal(r.estimated, true);
  assert.throws(() => snapshot({ ...base, day: undefined }));
  assert.throws(() => snapshot({ ...base, shares: undefined }));
  assert.throws(() => snapshot({ ...base, unitCost: "2" }));
});
test("daily uses adjacent disclosed NAVs across weekend; flows stay outside profit", () => {
  const rows = calc([open, trade("buy", { amount: "11.50", fee: "0.50" })]);
  assert.equal(rows[1].report.dailyProfit, "9.50");
  assert.equal(rows[1].report.marketValue, "121.00");
  assert.equal(rows.at(-1).report.dailyProfit, "-12.10");
  assert.equal(rows.at(-1).report.navDates[0], "2025-01-06");
  assert.equal(
    calc([open], quotes, "2025-01-05").at(-1).report.dailyProfit,
    null,
  );
});
test("redemption uses moving average basis, fee charged exactly once; full exit keeps realized P&L", () => {
  const r = calc([
    open,
    trade("sell", { shares: "100", amount: "109", fee: "1" }),
  ])[1].report;
  assert.equal(r.dailyProfit, "9.00");
  assert.equal(r.realized, "9.00");
  assert.equal(r.unrealized, "0.00");
  assert.equal(r.fundCount, 0);
  assert.throws(() =>
    validateBook([open, trade("sell", { shares: "101", amount: "111.1" })]),
  );
});
test("cash dividend and reinvested shares reconcile on ex-date", () => {
  const prices = [
    quotes[0],
    { ...quotes[1], nav: "0.9", action_note: "每份派现金0.1元" },
  ];
  const cash = trade("cash_dividend", {
    amount: "10",
    nav: undefined,
    shares: undefined,
  });
  assert.equal(calc([open, cash], prices)[1].report.dailyProfit, "0.00");
  const reinvest = trade("reinvest", {
    amount: "10",
    shares: "11.111111",
    nav: "0.9",
  });
  const r = calc([open, reinvest], prices)[1].report;
  assert.equal(r.dailyProfit, "0.00");
  assert.equal(r.realized, "10.00");
  assert.equal(r.cumulativeProfit, "0.00");
  assert.equal(
    calc([open], prices)[1].report.holdings[0].status,
    "reconcile_corporate_action",
  );
});
test("conversion pairs offset, price movement and explicit conversion fees remain", () => {
  const tx = trade("convert", {
    amount: "11",
    fee: "1",
    targetCode: "000002",
    targetShares: "5",
    targetNav: "2",
  });
  const nav = [...quotes, { ...quotes[1], code: "000002", nav: "2" }];
  const r = calc([open, tx], nav, "2025-01-03", [
    ...coverage,
    { ...coverage[0], code: "000002" },
  ]).at(-1).report;
  assert.equal(r.dailyProfit, "9.00");
  assert.equal(r.fundCount, 2);
  assert.equal(r.marketValue, "109.00");
});
test("pending unknown code cannot affect balance", () => {
  const pending = validateTrade({
    id: "p",
    platform: "测试平台",
    name: "虚构指数",
    amount: "400",
    status: "pending",
    kind: "buy",
    orderDay: "2025-01-02",
  });
  assert.equal(calc([open, pending]).at(-1).report.holdings[0].shares, "100");
});
test("QDII late disclosure gives null portfolio total and discloses partial subtotal", () => {
  const q = snapshot({ ...base, code: "000002", category: "QDII" });
  const r = calc([open, q], [...quotes, { ...quotes[0], code: "000002" }]).at(
    -1,
  ).report;
  assert.equal(r.dailyProfit, null);
  assert.equal(r.knownDailySubtotal, "-11.00");
  assert.deepEqual(r.navDates, ["2025-01-06", "2025-01-02"]);
});
test("interval profit, TWR, drawdown and XIRR handle flows/short history", () => {
  const series = calc([open, trade("buy")]),
    m = performance(series, "2025-01-03", "2025-01-06");
  assert.equal(m.profit, "-2.10");
  assert.equal(m.twrPct, "-1.000000");
  assert.equal(m.maxDrawdownPct, "10.000000");
  assert.equal(
    performance(series, "2025-01-01", "2025-01-02").maxDrawdownPct,
    null,
  );
  assert.equal(
    xirr([
      ["2023-01-01", D(-100)],
      ["2024-01-01", D(110)],
    ]).toFixed(6),
    "0.100000",
  );
  assert.equal(
    xirr([
      ["2023-01-01", D(-100)],
      ["2023-02-01", D(50)],
      ["2023-03-01", D(-50)],
      ["2024-01-01", D(110)],
    ]),
    null,
  );
});
test("missing coverage withholds daily and interval metrics; rounded lines never used for total", () => {
  assert.equal(
    calc([open], quotes, "2025-01-06", []).at(-1).report.dailyProfit,
    null,
  );
  const opens = [
    snapshot({ ...base, shares: "1", cost: "1" }),
    snapshot({ ...base, platform: "演示二", shares: "1", cost: "1" }),
  ];
  const q = [quotes[0], { ...quotes[1], nav: "1.004" }];
  const r = calc(opens, q, "2025-01-03").at(-1).report;
  assert.equal(r.holdings[0].dailyProfit, "0.00");
  assert.equal(r.dailyProfit, "0.01");
});
test("provider maps only disclosed unit NAV; rejects malformed, empty pages and money-market yield", async () => {
  const data = {
    Data: { LSJZList: [{ FSRQ: base.day, DWJZ: "1.2345", NAVTYPE: "1" }] },
    TotalCount: 1,
    PageIndex: 1,
    ErrCode: 0,
  };
  const run = (d) =>
    officialHistory(base.code, base.day, base.day, async () =>
      JSON.stringify(d),
    );
  assert.equal((await run(data))[0].nav, "1.2345");
  await assert.rejects(run({}));
  await assert.rejects(run({ ...data, TotalCount: 2, Data: { LSJZList: [] } }));
  await assert.rejects(
    run({
      ...data,
      Data: { LSJZList: [{ ...data.Data.LSJZList[0], NAVTYPE: "2" }] },
    }),
  );
});
test("provider network timeout aborts hanging response", async () => {
  const srv = http.createServer(() => {});
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    await assert.rejects(
      fetchText("http://127.0.0.1:" + srv.address().port, { timeout: 75 }),
      (e) => e.name === "TimeoutError",
    );
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});
test("full history from first confirmed purchase includes its initial fee and actual initial XIRR outflow", () => {
  const initial = trade("buy", {
    day: "2025-01-02",
    orderDay: "2025-01-02",
    shares: "100",
    nav: "1",
    amount: "101",
    fee: "1",
  });
  const r = performance(calc([initial]), "2025-01-01", "2025-01-06");
  assert.equal(r.status, "since_first_recorded_trade");
  assert.equal(r.profit, "-2.00");
  assert.equal(r.twrPct, D(99).div(101).minus(1).times(100).toFixed(6));
  assert.equal(
    r.xirrPct,
    xirr([
      ["2025-01-02", D(-101)],
      ["2025-01-06", D(99)],
    ])
      .times(100)
      .toFixed(6),
  );
});
