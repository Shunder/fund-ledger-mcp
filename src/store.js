import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { atomic } from "./db.js";
import { officialHistory } from "./source.js";
import { validateBook } from "./book.js";
import {
  snapshot,
  opening,
  validateTrade,
  transaction,
  key,
  label,
  code,
  requireValue,
  posKey,
  InputError,
} from "./model.js";

export const importInput = z.union([
  z.object({ rows: z.array(opening).min(1).max(200) }).strict(),
  z.object({ csv: z.string().min(1).max(90000) }).strict(),
]);
export const operation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), holding: opening }).strict(),
  z.object({ action: z.literal("update"), holding: opening }).strict(),
  z.object({ action: z.literal("import"), data: importInput }).strict(),
  z.object({ action: z.literal("record"), transaction }).strict(),
  z.object({ action: z.literal("delete_record"), id: key }).strict(),
  z
    .object({ action: z.literal("delete_holding"), platform: label, code })
    .strict(),
]);
export async function userLock(c, owner) {
  await c.query(
    "INSERT INTO ledger_users(owner) VALUES($1) ON CONFLICT DO NOTHING",
    [owner],
  );
  const { rows } = await c.query(
    "SELECT revision FROM ledger_users WHERE owner=$1 FOR UPDATE",
    [owner],
  );
  return rows[0].revision;
}
export async function eventsFor(c, owner) {
  const { rows } = await c.query(
    "SELECT id,body,created_at,updated_at FROM ledger_events WHERE owner=$1 ORDER BY seq",
    [owner],
  );
  return rows.map((r) => ({
    ...r.body,
    id: r.id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}
function withoutMeta(e) {
  const { id, createdAt, updatedAt, ...body } = e;
  return body;
}
function openingId(r) {
  return (
    "open-" +
    createHash("sha256").update(posKey(r.platform, r.code)).digest("hex")
  );
}
function importRows(data) {
  if (data.rows) return data.rows;
  let rows;
  try {
    rows = parse(data.csv, {
      bom: true,
      columns: (headers) => {
        requireValue(new Set(headers).size === headers.length, "重复 CSV 列");
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
    }).map((r) =>
      Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")),
    );
  } catch {
    throw new InputError("CSV 格式或列名错误");
  }
  return z.array(opening).min(1).max(200).parse(rows);
}
// Fetch before locking the book. Only public instrument codes and NAV dates leave the server.
async function datedInputs(pool, op) {
  if (!["add", "update", "import"].includes(op.action)) return op;
  const rows = op.action === "import" ? importRows(op.data) : [op.holding],
    cache = new Map();
  for (const row of rows) {
    if (
      row.shares ||
      row.snapshotNav ||
      !row.marketValue ||
      (row.unitCost && (row.cost !== undefined || row.returnPct !== undefined))
    )
      continue;
    const k = row.code + "@" + row.day;
    if (!cache.has(k)) {
      const { rows: cached } = await pool.query(
        "SELECT nav FROM fund_nav_history WHERE code=$1 AND day=$2",
        [row.code, row.day],
      );
      const nav =
        cached[0]?.nav ??
        (cache.size < 10
          ? (
              await officialHistory(row.code, row.day, row.day).catch(() => [])
            )[0]?.nav
          : null);
      cache.set(k, nav);
    }
    if (cache.get(k)) {
      row.snapshotNav = cache.get(k);
      row.navSource = "东方财富转引披露单位净值";
    }
  }
  return op.action === "import" ? { action: "import", data: { rows } } : op;
}
function makeOpening({ navSource, ...row }) {
  const e = snapshot(row);
  if (navSource) e.basis.push(navSource + " @ " + row.day);
  return e;
}
function changes(events, op) {
  const old = new Map(events.map((e) => [e.id, e])),
    next = new Map(old),
    seen = new Set();
  function put(id, body, update = false) {
    const previous = old.get(id);
    requireValue(!seen.has(id), "同一批次重复行");
    seen.add(id);
    if (previous && isDeepStrictEqual(withoutMeta(previous), body)) return;
    if (update) requireValue(previous, "要更新的期初记录不存在");
    else requireValue(!previous, "此持仓或交易 ID 已存在，内容不一致");
    next.set(id, { ...body, id });
  }
  switch (op.action) {
    case "add":
    case "update": {
      const e = makeOpening(op.holding);
      put(openingId(e), e, op.action === "update");
      break;
    }
    case "import": {
      const rows = op.data.rows;
      for (const r of rows) {
        const e = makeOpening(r);
        put(openingId(e), e);
      }
      break;
    }
    case "record": {
      const { id, ...body } = validateTrade(op.transaction);
      requireValue(!id.startsWith("open-"), "此 ID 前缀为快照保留");
      const prev = old.get(id);
      const confirm = prev?.status === "pending" && body.status === "confirmed";
      if (confirm)
        requireValue(
          body.kind === prev.kind &&
            body.platform === prev.platform &&
            (!prev.code || prev.code === body.code) &&
            prev.orderDay === body.orderDay,
          "确认信息与原流水不一致",
        );
      put(id, body, confirm);
      break;
    }
    case "delete_record":
      requireValue(next.delete(op.id), "记录不存在");
      break;
    case "delete_holding": {
      for (const [id, e] of old)
        if (
          e.platform === op.platform &&
          (e.code === op.code || e.targetCode === op.code)
        ) {
          requireValue(
            e.kind !== "convert",
            "含跨基金转换，请先预览并更正关联转换流水",
          );
          next.delete(id);
        }
      requireValue(next.size < old.size, "持仓不存在");
      break;
    }
  }
  validateBook([...next.values()]);
  return {
    remove: [...old.keys()].filter((id) => !next.has(id)),
    put: [...next.values()].filter((e) => old.get(e.id) !== e),
  };
}
async function persist(c, owner, delta) {
  for (const e of delta.put)
    await c.query(
      `INSERT INTO ledger_events(owner,id,body) VALUES($1,$2,$3) ON CONFLICT(owner,id) DO UPDATE SET body=excluded.body,updated_at=now()`,
      [owner, e.id, withoutMeta(e)],
    );
  if (delta.remove.length)
    await c.query(
      "DELETE FROM ledger_events WHERE owner=$1 AND id=ANY($2::text[])",
      [owner, delta.remove],
    );
  if (delta.put.length || delta.remove.length) {
    await c.query(
      "UPDATE ledger_users SET revision=revision+1 WHERE owner=$1",
      [owner],
    );
    await c.query("DELETE FROM daily_snapshots WHERE owner=$1", [owner]);
  }
  return {
    saved: delta.put.map((e) => e.id),
    deleted: delta.remove,
    unchanged: !delta.put.length && !delta.remove.length,
  };
}
export async function edit(pool, owner, input, preview = false) {
  const op = await datedInputs(pool, operation.parse(input));
  return atomic(pool, async (c) => {
    const rev = await userLock(c, owner),
      events = await eventsFor(c, owner),
      delta = changes(events, op);
    if (!preview) {
      requireValue(["record", "add"].includes(op.action), "需要预览并确认");
      return persist(c, owner, delta);
    }
    const token = randomUUID();
    await c.query("DELETE FROM previews WHERE owner=$1 AND expires<now()", [
      owner,
    ]);
    await c.query(
      "INSERT INTO previews(token,owner,revision,operation,expires) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
      [token, owner, rev, op],
    );
    return {
      token,
      expiresInSeconds: 600,
      requiresUserConfirmation: true,
      changes: {
        ...delta,
        previous: events.filter(
          (e) =>
            delta.remove.includes(e.id) || delta.put.some((n) => n.id === e.id),
        ),
      },
    };
  });
}
export async function confirm(pool, owner, token) {
  return atomic(pool, async (c) => {
    const rev = await userLock(c, owner);
    const { rows } = await c.query(
      "SELECT * FROM previews WHERE owner=$1 AND token=$2 AND expires>now()",
      [owner, token],
    );
    const p = rows[0];
    requireValue(p, "预览不存在或已过期");
    if (p.result) return p.result;
    requireValue(p.revision === rev, "账本已变化，请重新预览");
    const result = await persist(
      c,
      owner,
      changes(await eventsFor(c, owner), p.operation),
    );
    await c.query("UPDATE previews SET result=$3 WHERE owner=$1 AND token=$2", [
      owner,
      token,
      result,
    ]);
    return result;
  });
}
export async function inputs(c, owner) {
  const events = await eventsFor(c, owner),
    codes = [
      ...new Set(events.flatMap((e) => [e.code, e.targetCode]).filter(Boolean)),
    ];
  const { rows: quotes } = await c.query(
    "SELECT code,day,nav,action_note,updated_at FROM fund_nav_history WHERE code=ANY($1::text[]) ORDER BY day",
    [codes],
  );
  const { rows: coverage } = await c.query(
    "SELECT * FROM nav_coverage WHERE code=ANY($1::text[]) ORDER BY start_day",
    [codes],
  );
  const { rows: funds } = await c.query(
    "SELECT code,name,category,share_class FROM funds WHERE code=ANY($1::text[])",
    [codes],
  );
  return { events, quotes, coverage, funds };
}
export async function readInputs(pool, owner) {
  return atomic(pool, async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return inputs(c, owner);
  });
}
