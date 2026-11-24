import { refresh } from "./sync.js";
import { shift } from "./model.js";

export function latestSlot(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const day = [parts.year, parts.month, parts.day].join("-"),
    minute = Number(parts.hour) * 60 + Number(parts.minute);
  if (minute < 490) {
    const yesterday = shift(day, -1);
    return { slot: yesterday + "T23:10", day: yesterday };
  }
  if (minute < 1270) return { slot: day + "T08:10", day: shift(day, -1) };
  return { slot: day + (minute < 1390 ? "T21:10" : "T23:10"), day };
}
export async function scheduledRun(pool, now = new Date(), run = refresh) {
  const { slot, day } = latestSlot(now),
    c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query("SELECT pg_try_advisory_lock(713822) AS ok"))
      .rows[0].ok;
    if (!locked) return;
    const { rowCount } = await c.query(
      `INSERT INTO schedule_runs(slot,attempts) VALUES($1,1) ON CONFLICT(slot)
      DO UPDATE SET attempts=schedule_runs.attempts+1,updated_at=now()
      WHERE NOT schedule_runs.finished AND schedule_runs.attempts<3 AND schedule_runs.updated_at<now()-interval '15 minutes'
      RETURNING slot`,
      [slot],
    );
    if (!rowCount) return;
    let finished = true;
    for (const { owner } of (
      await c.query("SELECT owner FROM ledger_users ORDER BY owner")
    ).rows) {
      try {
        const r = await run(pool, owner, { end: day });
        if (["busy", "partial_failure"].includes(r.status)) finished = false;
      } catch {
        finished = false;
      }
    }
    await c.query("UPDATE schedule_runs SET finished=$2 WHERE slot=$1", [
      slot,
      finished,
    ]);
    console.log(
      JSON.stringify({
        job: "nav_sync",
        slot,
        status: finished ? "finished" : "retry_later",
      }),
    );
  } finally {
    try {
      if (locked) await c.query("SELECT pg_advisory_unlock(713822)");
    } finally {
      c.release();
    }
  }
}
export function startScheduler(pool) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await scheduledRun(pool);
    } catch {
      console.error("scheduler unavailable");
    } finally {
      running = false;
    }
  }
  void tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
