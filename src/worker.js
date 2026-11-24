import { poolFor, migrate } from "./db.js";
import { refresh } from "./sync.js";
import { today, shift } from "./model.js";
const pool = poolFor(process.env.DATABASE_URL);
try {
  await migrate(pool);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const day = hour < 12 ? shift(today(), -1) : today();
  const { rows } = await pool.query(
    "SELECT owner FROM ledger_users ORDER BY owner",
  );
  let failed = false;
  for (const { owner } of rows) {
    const result = await refresh(pool, owner, { end: day });
    if (["partial_failure", "busy"].includes(result.status)) failed = true;
  }
  console.log(
    JSON.stringify({
      job: "sync",
      day,
      status: failed ? "partial_failure" : "finished",
    }),
  );
  if (failed) process.exitCode = 1;
} catch {
  console.error("sync failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
