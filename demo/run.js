import { connectDemo, call } from "./client.js";
import { baseline, lastDay, period } from "./fixture.js";

const client = await connectDemo();
try {
  console.log("基金账本  ·  虚构账本与净值回放\n");
  await call(client, "refresh_portfolio", { start: baseline, end: lastDay });
  const r = await call(client, "get_daily_profit", { day: lastDay });
  console.table(
    r.holdings.map((h) => ({
      平台: h.platform,
      基金: h.name,
      份额: h.shares,
      市值: h.marketValue,
      净值日期: h.navDay,
      当日盈亏: h.dailyProfit ?? "待披露",
    })),
  );
  console.log(
    `组合持仓市值 ¥${r.marketValue}（采用各自最新净值）。已披露部分日收益 ¥${r.knownDailySubtotal}，组合日收益待披露。`,
  );
  const m = await call(client, "get_portfolio_performance", period);
  console.log(
    `\n${period.start} 至 ${period.end}  ·  区间收益 ¥${m.profit}\nXIRR（年化） ${m.xirrPct}%    最大回撤 ${m.maxDrawdownPct}%`,
  );
} finally {
  await client.close();
}
