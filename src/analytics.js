import { D, money, pct, posKey, shift } from "./model.js";
import { apply, empty, ordered } from "./book.js";

const sum = (xs) => xs.reduce((a, b) => a.plus(b), D(0));
const knownSum = (xs) => (xs.some((x) => x == null) ? null : sum(xs));
function external(e, nav) {
  if (e.kind === "opening") return nav ? D(e.shares).times(nav) : null;
  if (e.kind === "buy") return D(e.amount);
  if (e.kind === "sell" || e.kind === "cash_dividend") return D(e.amount).neg();
  return D(0);
}
function indexDays(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.day)) groups.set(row.day, []);
    groups.get(row.day).push(row);
  }
  return groups;
}
export function project(
  events,
  quotes,
  coverage,
  end,
  extraDays = [],
  funds = [],
) {
  const trades = indexDays(ordered(events).filter((e) => e.day <= end));
  const start = [...trades.keys()].sort()[0];
  const navDays = indexDays(quotes.filter((q) => q.day <= end));
  const days = [
    ...new Set([
      ...trades.keys(),
      ...navDays.keys(),
      ...extraDays.filter((d) => d <= end),
      end,
    ]),
  ].sort();
  const meta = new Map(funds.map((f) => [f.code, f]));
  const ranges = new Map();
  for (const r of coverage) {
    const arr = ranges.get(r.code) || [];
    arr.push(r);
    ranges.set(r.code, arr);
  }
  function covered(code, a, b) {
    if (!a) return false;
    let left = a;
    for (const r of ranges.get(code) || []) {
      if (r.end_day < left) continue;
      if (r.start_day > left) return false;
      if (r.end_day >= b) return true;
      left = shift(r.end_day, 1);
    }
    return false;
  }
  const latest = new Map(),
    positions = new Map(),
    series = [];
  for (const day of days) {
    const previous = new Map(latest);
    for (const q of navDays.get(day) || []) latest.set(q.code, q);
    if (!start || day < start) continue;
    const flows = new Map(),
      openingKeys = new Set(),
      activity = new Set(),
      dividends = new Set();
    for (const e of trades.get(day) || []) {
      const k = posKey(e.platform, e.code),
        s = positions.get(k) || empty(e);
      if (e.kind === "opening") openingKeys.add(k);
      if (["cash_dividend", "reinvest"].includes(e.kind)) dividends.add(k);
      if (e.kind !== "opening" && latest.get(e.code)?.day !== day)
        s.unpricedTrade = day;
      const flow = external(e, latest.get(e.code)?.nav);
      const old = flows.has(k) ? flows.get(k) : D(0);
      flows.set(k, old == null || flow == null ? null : old.plus(flow));
      if (!activity.has(k)) s.before = s.shares;
      activity.add(k);
      apply(s, e);
      positions.set(k, s);
    }
    const items = [];
    let periodCovered = true;
    for (const [k, s] of positions) {
      const before = activity.has(k) ? s.before : s.shares;
      const q = latest.get(s.code),
        prev = previous.get(s.code),
        nav = q ? D(q.nav) : null;
      if (
        q?.day === day &&
        before.gt(0) &&
        q.action_note &&
        (!/分红|派现|派发|派现金|分配/.test(q.action_note) || !dividends.has(k))
      )
        s.needsReconciliation = true;
      const value = s.needsReconciliation
        ? null
        : s.shares.isZero()
          ? D(0)
          : (nav?.times(s.shares) ?? null);
      const active = before.gt(0) || s.shares.gt(0) || activity.has(k);
      const fresh = q?.day === day;
      const startValue = before.isZero()
        ? D(0)
        : prev
          ? before.times(prev.nav)
          : null;
      const flow = flows.has(k) ? flows.get(k) : D(0);
      const ready =
        active &&
        !s.needsReconciliation &&
        (!s.unpricedTrade || s.unpricedTrade < (prev?.day || day)) &&
        fresh &&
        !openingKeys.has(k) &&
        (before.isZero() || covered(s.code, prev?.day, day));
      const profit =
        ready && startValue != null && flow != null
          ? value.minus(startValue).minus(flow)
          : null;
      if (s.needsReconciliation) periodCovered = false;
      if (before.gt(0) && !covered(s.code, prev?.day, day))
        periodCovered = false;
      if (active && !covered(s.code, series.at(-1)?.day || day, day))
        periodCovered = false;
      if (activity.has(k) && !fresh && !openingKeys.has(k))
        periodCovered = false;
      const unrealized = value?.minus(s.cost) ?? null;
      items.push({
        platform: s.platform,
        code: s.code,
        name: s.name ?? meta.get(s.code)?.name ?? null,
        category: s.category ?? meta.get(s.code)?.category ?? null,
        shareClass: s.shareClass ?? meta.get(s.code)?.share_class ?? null,
        shares: s.shares.toFixed(),
        cost: s.cost.toFixed(),
        unitCost: s.shares.gt(0) ? s.cost.div(s.shares).toFixed(8) : null,
        nav: q?.nav ?? null,
        navDay: q?.day ?? null,
        previousNavDay: prev?.day ?? null,
        dataUpdatedAt: q?.updated_at ?? null,
        marketValue: money(value),
        unrealized: money(unrealized),
        realized: s.needsReconciliation ? null : money(s.realized),
        holdingReturnPct: pct(
          s.cost.gt(0) && unrealized != null ? unrealized.div(s.cost) : null,
        ),
        estimated: s.estimated,
        basis: s.basis,
        basisDay: s.basisDay ?? null,
        reportedSnapshotValue: s.reportedSnapshotValue ?? null,
        reportedSnapshotNav: s.reportedSnapshotNav ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        dailyProfit: money(profit),
        status: s.needsReconciliation
          ? "reconcile_corporate_action"
          : !active
            ? "closed"
            : openingKeys.has(k)
              ? "opening_snapshot"
              : !fresh
                ? "awaiting_nav"
                : profit == null
                  ? "insufficient_history"
                  : "disclosed",
        active,
        value,
        profit,
        startValue,
        flow,
        unrealizedRaw: unrealized,
        realizedRaw: s.needsReconciliation ? null : s.realized,
      });
    }
    const participating = items.filter((i) => i.active);
    const value = knownSum(items.map((i) => i.value)),
      flow = knownSum(items.map((i) => i.flow));
    const profits = participating.map((i) => i.profit);
    const daily = participating.length ? knownSum(profits) : null;
    const base = knownSum(items.map((i) => i.startValue));
    const unrl = knownSum(items.map((i) => i.unrealizedRaw)),
      realized = knownSum(items.map((i) => i.realizedRaw));
    const details = items.map(
      ({
        active,
        value,
        profit,
        startValue,
        flow,
        unrealizedRaw,
        realizedRaw,
        ...rest
      }) => rest,
    );
    const byFund = [];
    for (const code of new Set(items.map((i) => i.code))) {
      const lines = items.filter((i) => i.code === code),
        exposed = lines.filter((i) => i.active);
      byFund.push({
        code,
        shares: sum(lines.map((i) => D(i.shares))).toFixed(),
        marketValue: money(knownSum(lines.map((i) => i.value))),
        dailyProfit: money(
          exposed.length ? knownSum(exposed.map((i) => i.profit)) : null,
        ),
        navDay: lines[0].navDay,
        dataUpdatedAt: lines[0].dataUpdatedAt,
      });
    }
    const report = {
      day,
      byFund,
      totalCost: money(sum(items.map((i) => D(i.cost)))),
      navDates: [...new Set(participating.map((i) => i.navDay))],
      dataUpdatedAt:
        items
          .map((i) => i.dataUpdatedAt)
          .filter(Boolean)
          .map((x) => new Date(x).toISOString())
          .sort()
          .at(-1) ?? null,
      fundCount: new Set(
        items.filter((i) => D(i.shares).gt(0)).map((i) => i.code),
      ).size,
      marketValue: money(value),
      dailyProfit: money(daily),
      dailyReturnPct: pct(
        daily != null && base?.gt(0) ? daily.div(base) : null,
      ),
      knownDailySubtotal: money(
        profits.some((p) => p != null)
          ? sum(profits.filter((p) => p != null))
          : null,
      ),
      realized: money(realized),
      unrealized: money(unrl),
      cumulativeProfit: money(
        unrl != null && realized != null ? unrl.plus(realized) : null,
      ),
      estimated: items.some((i) => i.estimated),
      status: daily == null ? "incomplete" : "complete",
      holdings: details,
    };
    series.push({
      day,
      report,
      value,
      flow,
      periodCovered,
      firstDayFromTrades: day === start && openingKeys.size === 0,
      endValued:
        participating.every((i) => i.navDay === day) || !participating.length,
    });
  }
  return series;
}
export function xirr(flows) {
  const grouped = new Map();
  for (const [d, v] of flows) grouped.set(d, (grouped.get(d) || D(0)).plus(v));
  const entries = [...grouped]
    .filter(([, v]) => !v.isZero())
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 2 || entries[0][1].gte(0) || entries.at(-1)[1].lte(0))
    return null;
  // Conservative uniqueness test for conventional cash flows.
  let positive = false;
  for (const [, v] of entries) {
    if (positive && v.lt(0)) return null;
    if (v.gt(0)) positive = true;
  }
  const epoch = Date.parse(entries[0][0]);
  const timed = entries.map(([d, v]) => [
    D(Date.parse(d) - epoch).div(86400000 * 365),
    v,
  ]);
  const npv = (r) => sum(timed.map(([t, v]) => v.div(r.plus(1).pow(t))));
  let lo = D("-0.99999999"),
    hi = D(1);
  while (npv(hi).gt(0) && hi.lt("1e8")) hi = hi.times(2).plus(1);
  if (npv(lo).lt(0) || npv(hi).gt(0)) return null;
  for (let i = 0; i < 90; i++) {
    const mid = lo.plus(hi).div(2);
    if (npv(mid).gt(0)) lo = mid;
    else hi = mid;
  }
  return lo.plus(hi).div(2);
}
// Inclusive start/end. A close from before the period is required to capture its first day.
export function performance(series, start, end) {
  const window = series.filter((r) => r.day >= start && r.day <= end);
  const prior = series.filter((r) => r.day < start).at(-1);
  const base = prior || window[0],
    last = window.at(-1);
  const out = {
    requestedStart: start,
    end,
    baselineDay: base?.day ?? null,
    navDates: last?.report.navDates ?? [],
    dataUpdatedAt: last?.report.dataUpdatedAt ?? null,
    estimated: window.some((r) => r.report.estimated),
    status: "insufficient_history",
    profit: null,
    twrPct: null,
    maxDrawdownPct: null,
    xirrPct: null,
  };
  if (
    !base ||
    !last ||
    last === base ||
    !last.endValued ||
    last.day !== end ||
    base.value == null ||
    last.value == null
  )
    return out;
  const fromFirstTrade = !prior && base.firstDayFromTrades;
  const steps = fromFirstTrade
    ? window
    : window.filter((r) => r.day > base.day);
  if (steps.some((r) => !r.periodCovered || r.value == null || r.flow == null))
    return out;
  let wealth = D(1),
    peak = D(1),
    dd = D(0),
    prev = fromFirstTrade ? D(0) : base.value,
    profit = D(0),
    linked = true;
  const flows = [[base.day, prev.neg()]];
  for (const r of steps) {
    const gain = r.value.minus(prev).minus(r.flow);
    profit = profit.plus(gain);
    // When an empty account begins investing, its initial contribution funds the first fee.
    const capital = prev.gt(0) ? prev : r.flow;
    if (capital.gt(0)) {
      wealth = wealth.times(gain.div(capital).plus(1));
      peak = DecimalMax(peak, wealth);
      dd = DecimalMax(dd, D(1).minus(wealth.div(peak)));
    } else if (!gain.isZero()) linked = false;
    prev = r.value;
    flows.push([r.day, r.flow.neg()]);
  }
  flows.push([end, last.value]);
  return {
    ...out,
    status: prior
      ? "complete"
      : fromFirstTrade
        ? "since_first_recorded_trade"
        : "since_first_observed_close",
    profit: money(profit),
    twrPct: linked ? pct(wealth.minus(1)) : null,
    maxDrawdownPct: linked ? pct(dd) : null,
    xirrPct: pct(xirr(flows)),
  };
}
const DecimalMax = (a, b) => (a.gt(b) ? a : b);
