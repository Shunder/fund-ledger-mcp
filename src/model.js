import Decimal from "decimal.js";
import { z } from "zod";
Decimal.set({
  precision: 44,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 55,
});
export const D = (x) => new Decimal(x);
export const money = (x) =>
  x == null ? null : x.toDecimalPlaces(2).toFixed(2);
export const pct = (x) => (x == null ? null : x.times(100).toFixed(6));
export class InputError extends Error {
  constructor(message, missingFields) {
    super(message);
    this.missingFields = missingFields;
  }
}
export function requireValue(condition, message) {
  if (!condition) throw new InputError(message);
}
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function shift(day, n) {
  const dt = new Date(day + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const date = z
  .string()
  .date()
  .min(10)
  .refine(
    (v) => v >= "1990-01-01" && v <= today(),
    "日期必须为已发生的上海日期",
  );
export const code = z.string().regex(/^\d{6}$/);
export const label = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const key = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
export const number = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/)
  .describe("十进制字符串，不含千分位");
const positive = number.refine((x) => D(x).gt(0), "必须大于零");
const fund = {
  platform: label,
  code,
  name: label.optional(),
  category: label.optional(),
  shareClass: label.optional(),
  currency: z.literal("CNY").optional().describe("仅人民币计价份额，默认 CNY"),
};
export const opening = z
  .object({
    ...fund,
    day: date,
    shares: positive.optional(),
    cost: number.optional(),
    unitCost: positive.optional(),
    marketValue: positive.optional(),
    snapshotNav: positive.optional(),
    returnPct: z
      .string()
      .regex(/^-?\d{1,8}(\.\d{1,8})?$/)
      .optional(),
  })
  .strict();
export const transaction = z
  .object({
    ...fund,
    code: code.optional(),
    id: key,
    kind: z.enum(["buy", "sell", "cash_dividend", "reinvest", "convert"]),
    status: z.enum(["pending", "confirmed"]).default("confirmed"),
    orderDay: date,
    exDay: date
      .optional()
      .describe("分红除息日，省略时与到账或份额确认日 day 相同"),
    day: date.optional(),
    shares: positive.optional(),
    nav: positive.optional(),
    amount: positive,
    fee: number.default("0"),
    targetCode: code.optional(),
    targetShares: positive.optional(),
    targetNav: positive.optional(),
  })
  .strict();
export const posKey = (p, c) => JSON.stringify([p, c]);
export function snapshot(row) {
  const r = opening.parse(row),
    basis = [];
  let shares = r.shares && D(r.shares),
    cost = r.cost !== undefined ? D(r.cost) : null;
  if (cost == null && r.marketValue && r.returnPct !== undefined) {
    const factor = D(r.returnPct).div(100).plus(1);
    requireValue(factor.gt(0), "收益率须大于 -100% 才能推算成本");
    cost = D(r.marketValue).div(factor);
    basis.push("成本 = 市值 ÷ (1 + 收益率)");
  }
  if (!shares && r.marketValue && r.snapshotNav) {
    shares = D(r.marketValue).div(r.snapshotNav);
    basis.push("份额 = 市值 ÷ 快照日净值");
  }
  if (!shares && cost && r.unitCost) {
    shares = cost.div(r.unitCost);
    basis.push("份额 = 成本 ÷ 成本单价");
  }
  if (cost == null && shares && r.unitCost) {
    cost = shares.times(r.unitCost);
    basis.push("成本 = 份额 × 成本单价");
  }
  if (!shares?.gt(0) || cost == null) {
    const missingFields = [];
    if (!shares?.gt(0)) missingFields.push("shares");
    if (cost == null) missingFields.push("cost");
    throw new InputError(
      "请提供确认份额与总成本或成本单价，或提供同日市值与净值及成本依据",
      missingFields,
    );
  }
  const near = (a, b, t) => D(a).minus(b).abs().lte(t);
  if (r.unitCost)
    requireValue(
      near(cost.div(shares), r.unitCost, "0.00005"),
      "成本与份额、成本单价不一致",
    );
  if (r.marketValue && r.snapshotNav)
    requireValue(
      near(shares.times(r.snapshotNav), r.marketValue, "0.02"),
      "市值与净值、份额不一致",
    );
  if (r.marketValue && r.returnPct && cost.gt(0))
    requireValue(
      near(D(r.marketValue).div(cost).minus(1).times(100), r.returnPct, "0.01"),
      "收益率与市值、成本不一致",
    );
  return {
    ...r,
    kind: "opening",
    status: "confirmed",
    shares: shares.toDecimalPlaces(12).toFixed(),
    cost: cost.toDecimalPlaces(12).toFixed(),
    estimated: basis.length > 0,
    basis,
    basisDay: r.day,
  };
}
export function validateTrade(input) {
  const e = transaction.parse(input);
  if (e.exDay)
    requireValue(
      ["cash_dividend", "reinvest"].includes(e.kind) &&
        (!e.day || e.exDay <= e.day),
      "exDay 仅用于分红，须早于或等于到账或份额确认日",
    );
  if (e.status === "pending") {
    requireValue(e.code || e.name, "待确认流水需要代码或基金名称");
    requireValue(
      !e.day && !e.shares && !e.nav && !e.targetShares && !e.targetNav,
      "待确认流水不能包含确认日期、确认份额或净值",
    );
    return e;
  }
  requireValue(
    e.code && e.day && e.day >= e.orderDay,
    "缺少基金代码或有效确认日期 day",
  );
  if (e.kind === "cash_dividend") {
    requireValue(
      !e.shares && !e.nav && D(e.fee).isZero(),
      "现金分红填写到账金额，不填份额、净值或费用",
    );
  } else {
    requireValue(e.shares && e.nav, "缺少确认份额 shares 或确认净值 nav");
    const value = D(e.shares).times(e.nav);
    const net =
      e.kind === "buy"
        ? D(e.amount).minus(e.fee)
        : e.kind === "sell"
          ? D(e.amount).plus(e.fee)
          : D(e.amount);
    requireValue(
      value.minus(net).abs().lte(D(e.nav).times("0.005").plus("0.01")),
      "确认金额、份额、净值及费用不相符",
    );
    if (e.kind === "reinvest")
      requireValue(D(e.fee).isZero(), "红利再投资不收取单列费用");
  }
  if (e.kind === "convert") {
    requireValue(
      e.targetCode && e.targetCode !== e.code && e.targetShares && e.targetNav,
      "缺少不同的转入代码、份额或确认净值",
    );
    requireValue(
      D(e.targetShares)
        .times(e.targetNav)
        .plus(e.fee)
        .minus(e.amount)
        .abs()
        .lte(D(e.targetNav).times("0.005").plus("0.01")),
      "转入份额与转换金额、费用不符",
    );
  } else
    requireValue(
      !e.targetCode && !e.targetShares && !e.targetNav,
      "只有转换流水可以填写转入基金",
    );
  return e;
}
