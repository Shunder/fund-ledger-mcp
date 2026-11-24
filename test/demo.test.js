import test from "node:test";
import assert from "node:assert/strict";
import { call, connectDemo } from "../demo/client.js";
import { baseline, lastDay, period } from "../demo/fixture.js";

test("isolated stdio demo discovers tools, replays NAV, computes March, requires preview and resets", async () => {
  const client = await connectDemo();
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.every((t) => t._meta.securitySchemes[0].type === "noauth"));
    assert.ok(
      !tools.some((t) =>
        ["record_transaction", "get_fund_nav"].includes(t.name),
      ),
    );
    const sync = await call(client, "refresh_portfolio", {
      start: baseline,
      end: lastDay,
    });
    assert.deepEqual(
      sync.funds.map((f) => f.status),
      ["disclosed", "awaiting_nav"],
    );
    const daily = await call(client, "get_daily_profit", { day: lastDay });
    assert.equal(daily.dailyProfit, null);
    assert.equal(daily.knownDailySubtotal, "6.00");
    const month = await call(client, "get_portfolio_performance", period);
    assert.deepEqual(
      [month.profit, month.xirrPct, month.maxDrawdownPct],
      ["30.60", "20.697315", "2.646326"],
    );
    const tx = {
      kind: "buy",
      id: "plan-0331",
      code: "990001",
      platform: "演示钱包",
      orderDay: period.end,
      day: period.end,
      shares: "100",
      nav: "1.018",
      amount: "101.80",
    };
    const { token } = await call(client, "preview_portfolio_changes", {
      operation: { action: "record", transaction: tx },
    });
    const filter = {
      platform: tx.platform,
      code: tx.code,
      kind: "buy",
      status: "confirmed",
    };
    assert.equal((await call(client, "get_transactions", filter)).total, 0);
    await call(client, "confirm_changes", { token });
    await call(client, "confirm_changes", { token });
    assert.equal((await call(client, "get_transactions", filter)).total, 1);
    assert.equal(
      (
        await call(client, "get_transactions", {
          ...filter,
          platform: "演示银行",
        })
      ).total,
      0,
    );
    assert.equal(
      (
        await call(client, "get_holding", {
          platform: tx.platform,
          code: tx.code,
          day: period.end,
        })
      ).combinedShares,
      "1100",
    );
    const conversion = {
      ...tx,
      id: "switch-0331",
      kind: "convert",
      amount: "10.18",
      shares: "10",
      fee: "0.09",
      targetCode: "990002",
      targetShares: "10",
      targetNav: "1.009",
    };
    const preview = await call(client, "preview_portfolio_changes", {
      operation: { action: "record", transaction: conversion },
    });
    await call(client, "confirm_changes", { token: preview.token });
    for (const code of [tx.code, conversion.targetCode]) {
      const { items } = await call(client, "get_transactions", {
        ...filter,
        code,
        kind: "convert",
      });
      assert.deepEqual(
        items.map((e) => e.id),
        [conversion.id],
      );
    }
  } finally {
    await client.close();
  }
  const reset = await connectDemo();
  try {
    assert.equal(
      (await call(reset, "get_transactions", { kind: "buy" })).total,
      0,
    );
  } finally {
    await reset.close();
  }
});
