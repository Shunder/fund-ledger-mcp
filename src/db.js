import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
pg.types.setTypeParser(1082, (value) => value);
export function poolFor(connectionString) {
  if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString))
    throw Error("DATABASE_URL must be PostgreSQL");
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 120000,
  });
  // pg discards disconnected idle clients. Keep the HTTP process alive for the next checkout.
  pool.on("error", () => console.error("database connection interrupted"));
  return pool;
}
export async function atomic(pool, fn) {
  if (pool.transaction) return pool.transaction(fn);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function migrate(pool) {
  const dir = new URL("../migrations/", import.meta.url);
  await atomic(pool, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(982311)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL)",
    );
    for (const name of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(name, dir), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const { rows } = await c.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (rows.length) {
        if (rows[0].checksum !== hash)
          throw Error("migration checksum mismatch");
        continue;
      }
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations VALUES($1,$2)", [
        name,
        hash,
      ]);
    }
  });
}
