import { D, requireValue, posKey } from "./model.js";

// One confirmed conversion is an indivisible pair of end-of-day legs.
export function legs(e) {
  if (e.status === "pending") return [];
  if (e.kind !== "convert") return [e];
  const proceeds = D(e.amount).minus(e.fee).toFixed();
  return [
    { ...e, kind: "sell", amount: proceeds },
    {
      platform: e.platform,
      code: e.targetCode,
      kind: "buy",
      day: e.day,
      amount: proceeds,
      shares: e.targetShares,
      nav: e.targetNav,
      fee: "0",
      status: "confirmed",
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    },
  ];
}
export function empty(e) {
  return {
    code: e.code,
    platform: e.platform,
    shares: D(0),
    cost: D(0),
    realized: D(0),
    estimated: false,
    basis: [],
    createdAt: e.createdAt,
  };
}
export function apply(s, e) {
  const q = D(e.shares || 0),
    a = D(e.amount || 0);
  for (const k of ["name", "category", "shareClass"]) if (e[k]) s[k] = e[k];
  s.updatedAt = e.updatedAt;
  switch (e.kind) {
    case "opening":
      requireValue(!s.started, "期初快照必须是此平台与基金的首条确认记录");
      s.shares = q;
      s.cost = D(e.cost);
      s.estimated = e.estimated;
      s.basis = e.basis;
      s.basisDay = e.day;
      break;
    case "buy":
      s.shares = s.shares.plus(q);
      s.cost = s.cost.plus(a);
      break;
    case "sell": {
      requireValue(q.lte(s.shares), "赎回或转换超过当日可用份额");
      const basis = q.eq(s.shares) ? s.cost : s.cost.times(q).div(s.shares);
      s.shares = s.shares.minus(q);
      s.cost = s.cost.minus(basis);
      s.realized = s.realized.plus(a).minus(basis);
      break;
    }
    case "cash_dividend":
    case "reinvest":
      requireValue(s.shares.gt(0), "分红日没有确认持仓");
      s.realized = s.realized.plus(a);
      if (e.kind === "reinvest") {
        s.shares = s.shares.plus(q);
        s.cost = s.cost.plus(a);
      }
      break;
  }
  s.started = true;
}
export function ordered(events) {
  return events
    .flatMap(legs)
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        Number(b.kind === "opening") - Number(a.kind === "opening"),
    );
}
export function validateBook(events) {
  const positions = new Map();
  for (const e of ordered(events)) {
    const k = posKey(e.platform, e.code),
      s = positions.get(k) || empty(e);
    apply(s, e);
    positions.set(k, s);
  }
}
