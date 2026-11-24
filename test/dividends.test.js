import test from "node:test";
import assert from "node:assert/strict";
import { project, performance } from "../src/analytics.js";
import { snapshot, validateTrade } from "../src/model.js";

const code = "990001",
  start = "2025-03-03",
  exDay = "2025-03-04",
  day = "2025-03-05";
const open = (platform) =>
  snapshot({ platform, code, day: start, shares: "100", cost: "100" });
function dividend(kind, platform, extra = {}) {
  return validateTrade({
    kind,
    id: kind,
    platform,
    code,
    orderDay: exDay,
    day,
    exDay,
    amount: "10",
    ...(kind === "reinvest" ? { shares: "11.11", nav: "0.9" } : {}),
    ...extra,
  });
}
function series(events, note = "每份基金份额发放红利0.1元") {
  const quotes = [start, exDay, day].map((d, i) => ({
    code,
    day: d,
    nav: i ? "0.9" : "1",
    action_note: i === 1 ? note : null,
  }));
  return project(
    events,
    quotes,
    [{ code, start_day: start, end_day: day }],
    day,
  );
}
test("two platforms: ex-date receivables bridge settlement; external cash and reinvest shares reconcile independently", () => {
  const events = [
    open("钱包"),
    open("银行"),
    dividend("reinvest", "钱包"),
    dividend("cash_dividend", "银行"),
  ];
  const timeline = series(events);
  const accrual = timeline[1].report;
  assert.equal(accrual.marketValue, "180.00");
  assert.equal(accrual.assetValue, "200.00");
  assert.equal(accrual.dailyProfit, "0.00");
  for (const h of accrual.holdings) {
    assert.equal(h.dividendReceivable, "10.00");
    assert.equal(h.shares, "100");
    assert.equal(h.realized, "10.00");
    assert.equal(h.cost, "100");
  }
  const close = timeline[2].report,
    [wallet, bank] = close.holdings;
  assert.equal(wallet.dividendsReinvested, "10.00");
  assert.equal(wallet.reinvestedShares, "11.11");
  assert.equal(wallet.shares, "111.11");
  assert.equal(wallet.cost, "110");
  assert.equal(bank.shares, "100");
  assert.equal(bank.cashDividendsReceived, "10.00");
  assert.equal(bank.dividendReceivable, "0.00");
  assert.equal(close.realized, "20.00");
  assert.equal(close.cumulativeProfit, "0.00");
  assert.equal(timeline[2].flow.toString(), "-10");
  assert.equal(performance(timeline, exDay, day).profit, "0.00");
});
test("missing platform entitlement, pending dividend and mixed split remain unreconciled", () => {
  const events = [open("钱包"), open("银行"), dividend("reinvest", "钱包")];
  const pending = dividend("cash_dividend", "银行", {
    status: "pending",
    day: undefined,
  });
  const report = series([...events, pending]).at(-1).report;
  assert.equal(report.dailyProfit, null);
  assert.equal(report.holdings[0].status, "disclosed");
  assert.equal(report.holdings[1].status, "reconcile_corporate_action");
  assert.equal(
    series(events, "分红并折算").at(-1).report.holdings[0].status,
    "reconcile_corporate_action",
  );
  assert.throws(() => dividend("reinvest", "钱包", { exDay: "2025-03-06" }));
  assert.throws(() => dividend("buy", "钱包", { shares: "10", nav: "1" }));
});
test("dividend earned before full sale can settle after shares reach zero", () => {
  const sale = validateTrade({
    kind: "sell",
    platform: "钱包",
    code,
    id: "sale",
    orderDay: exDay,
    day: exDay,
    amount: "90",
    shares: "100",
    nav: "0.9",
  });
  const timeline = series([
    open("钱包"),
    sale,
    dividend("cash_dividend", "钱包"),
  ]);
  assert.equal(timeline[1].report.assetValue, "10.00");
  assert.equal(timeline[2].report.assetValue, "0.00");
  assert.equal(timeline[2].report.cumulativeProfit, "0.00");
});

test("cash paid on a day without NAV preserves the next disclosed return and period coverage", () => {
  const payout = "2025-03-08",
    end = "2025-03-10";
  const events = [
    open("银行"),
    dividend("cash_dividend", "银行", { day: payout }),
  ];
  const navs = [
    [start, "1"],
    [exDay, "0.9"],
    [end, "0.91"],
  ].map(([d, nav]) => ({ code, nav, day: d }));
  const t = project(
    events,
    navs,
    [{ code, start_day: start, end_day: end }],
    end,
  );
  assert.equal(t.find((r) => r.day === payout).report.dailyProfit, null);
  assert.equal(t.at(-1).report.dailyProfit, "1.00");
  assert.equal(performance(t, exDay, end).profit, "1.00");
});
