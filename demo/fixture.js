import { D, shift } from "../src/model.js";

export const baseline = "2025-02-28";
export const period = { start: "2025-03-01", end: "2025-03-31" };
export const lastDay = "2025-04-01";
export const positions = [
  {
    platform: "演示钱包",
    code: "990001",
    name: "示例均衡 A",
    shares: "1000",
    cost: "1000",
  },
  {
    platform: "演示银行",
    code: "990001",
    name: "示例均衡 A",
    shares: "500",
    cost: "500",
  },
  {
    platform: "演示银行",
    code: "990002",
    name: "示例海外 QDII",
    shares: "400",
    cost: "400",
  },
].map((p) => ({ ...p, day: baseline }));

// Entirely fictional unit NAV series. A dip midway makes drawdown observable.
export async function replayNav(code, start, end) {
  const rows = [];
  for (let day = baseline, i = 0; day <= lastDay; day = shift(day, 1)) {
    if ([0, 6].includes(new Date(day).getUTCDay())) continue;
    if (day === lastDay && code === "990002") continue;
    const change = i <= 8 ? i : i <= 13 ? 8 - 3 * (i - 8) : -7 + 2 * (i - 13);
    const nav = D(1).plus(
      D(change).times(code === "990001" ? "0.002" : "0.001"),
    );
    if (["990001", "990002"].includes(code) && day >= start && day <= end)
      rows.push({ code, day, nav: nav.toFixed(4) });
    i++;
  }
  return rows;
}
