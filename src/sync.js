import { atomic } from "./db.js";
import { getFundInfo } from "./api.js";
import { officialHistory } from "./source.js";
import { today, shift, requireValue } from "./model.js";
import { inputs, eventsFor, userLock } from "./store.js";
import { project } from "./analytics.js";

async function ingest(pool, code, start, end, source) {
  // Keep each upstream result bounded; commit complete pages and coverage together.
  for (let left = start; left <= end;) {
    const right = [shift(left, 89), end].sort()[0];
    const { rowCount } = await pool.query(
      `SELECT 1 FROM nav_coverage WHERE code=$1 AND start_day<=$2 AND end_day>=$3
      AND checked_at>now()-interval '5 minutes' LIMIT 1`,
      [code, left, right],
    );
    if (!rowCount) {
      const rows = await source(code, left, right);
      await atomic(pool, async (c) => {
        if (rows.length)
          await c.query(
            `INSERT INTO fund_nav_history(code,day,nav,action_note)
          SELECT $1,t.day,t.nav,t.action FROM jsonb_to_recordset($2) AS t(day date,nav numeric,action text)
          ON CONFLICT(code,day) DO UPDATE SET nav=excluded.nav,action_note=excluded.action_note,updated_at=now()
          WHERE (fund_nav_history.nav,fund_nav_history.action_note) IS DISTINCT FROM (excluded.nav,excluded.action_note)`,
            [code, JSON.stringify(rows)],
          );
        await c.query(
          `INSERT INTO nav_coverage(code,start_day,end_day) VALUES($1,$2,$3)
          ON CONFLICT(code,start_day,end_day) DO UPDATE SET checked_at=now()`,
          [code, left, right],
        );
      });
    }
    left = shift(right, 1);
  }
}
async function log(pool, owner, day, status, code = null) {
  await pool.query(
    "INSERT INTO sync_logs(owner,day,status,code) VALUES($1,$2,$3,$4)",
    [owner, day, status, code],
  );
}
let busy = false;
export async function refresh(
  pool,
  owner,
  { start, end = today() } = {},
  source = officialHistory,
  profile = source === officialHistory ? getFundInfo : null,
) {
  requireValue(!busy, "已有同步执行中，请稍后重试");
  busy = true;
  let lock,
    acquired = false;
  try {
    lock = await pool.connect();
    acquired = (await lock.query("SELECT pg_try_advisory_lock(713821) AS ok"))
      .rows[0].ok;
    if (!acquired) return { status: "busy" };
    const events = await eventsFor(pool, owner);
    if (!events.length) return { status: "empty" };
    const codes = [
      ...new Set(events.flatMap((e) => [e.code, e.targetCode]).filter(Boolean)),
    ];
    const states = [];
    for (const code of codes) {
      const first = events
        .filter((e) => e.code === code || e.targetCode === code)
        .map((e) => e.day || e.orderDay)
        .sort()[0];
      try {
        await ingest(pool, code, start || shift(end, -31), end, source);
        if (profile) {
          const cached = await pool.query(
            "SELECT 1 FROM funds WHERE code=$1 AND updated_at>now()-interval '7 days'",
            [code],
          );
          if (!cached.rowCount) {
            const info = await profile(code).catch(() => null);
            if (info?.fundCode === code)
              await pool.query(
                `INSERT INTO funds(code,name,category,share_class) VALUES($1,$2,$3,$4)
              ON CONFLICT(code) DO UPDATE SET name=excluded.name,category=excluded.category,share_class=excluded.share_class,updated_at=now()`,
                [
                  code,
                  info.name,
                  info.type,
                  info.name?.match(/([AC])(?:类|份额)?$/)?.[1] ?? null,
                ],
              );
          }
        }
        if (!start) {
          // Fill one older quarter per run, starting beside the most recent contiguous coverage.
          const { rows } = await pool.query(
            "SELECT start_day,end_day FROM nav_coverage WHERE code=$1 AND start_day<=$2 ORDER BY end_day DESC",
            [code, end],
          );
          let edge = shift(end, 1);
          for (const r of rows)
            if (r.end_day >= shift(edge, -1) && r.start_day < edge)
              edge = r.start_day;
          const goal = shift(first, -14);
          if (edge > goal)
            await ingest(
              pool,
              code,
              [shift(edge, -90), goal].sort().at(-1),
              shift(edge, -1),
              source,
            );
        }
        const { rows } = await pool.query(
          "SELECT max(day) AS latest FROM fund_nav_history WHERE code=$1 AND day<=$2",
          [code, end],
        );
        const status = rows[0].latest === end ? "disclosed" : "awaiting_nav";
        states.push({ code, status, latestNavDay: rows[0].latest });
        await log(pool, owner, end, status, code);
      } catch {
        states.push({ code, status: "source_error" });
        await log(pool, owner, end, "source_error", code);
      }
    }
    await atomic(pool, async (c) => {
      const rev = await userLock(c, owner),
        data = await inputs(c, owner);
      const timeline = project(
        data.events,
        data.quotes,
        data.coverage,
        end,
        [],
        data.funds,
      );
      if (timeline.length)
        await c.query(
          `INSERT INTO daily_snapshots(owner,day,report,revision)
        SELECT $1,t.day,t.report,$2 FROM jsonb_to_recordset($3) AS t(day date,report jsonb)
        ON CONFLICT(owner,day) DO UPDATE SET report=excluded.report,revision=excluded.revision,updated_at=now()
        WHERE (daily_snapshots.report,daily_snapshots.revision) IS DISTINCT FROM (excluded.report,excluded.revision)`,
          [
            owner,
            rev,
            JSON.stringify(
              timeline.map((r) => ({ day: r.day, report: r.report })),
            ),
          ],
        );
    });
    return {
      status: states.some((s) => s.status === "source_error")
        ? "partial_failure"
        : "finished",
      targetDay: end,
      funds: states,
    };
  } finally {
    try {
      if (acquired) await lock.query("SELECT pg_advisory_unlock(713821)");
    } finally {
      lock?.release();
      busy = false;
    }
  }
}
