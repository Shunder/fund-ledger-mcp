#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { poolFor, migrate } from "./db.js";
import { config, appFor, ownerId } from "./http.js";
import { mcpServer } from "./tools.js";
import { startScheduler } from "./schedule.js";
let pool;
try {
  const conf = config(process.env);
  pool = poolFor(process.env.DATABASE_URL);
  await migrate(pool);
  if (process.argv.includes("--http")) {
    const server = appFor(pool, conf).listen(
      Number(process.env.PORT || 3000),
      "0.0.0.0",
    );
    server.headersTimeout = 15000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
    const stopTimer =
      process.env.SCHEDULER_ENABLED === "false"
        ? () => {}
        : startScheduler(pool);
    const stop = () => {
      stopTimer();
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } else {
    const sub = process.env.STDIO_SUBJECT;
    if (!conf.allowed.includes(sub)) throw Error("CONFIG_STDIO_SUBJECT");
    const server = mcpServer(
      {
        pool,
        owner: ownerId(conf.issuer, sub),
        origin: conf.origin,
        scopes: ["portfolio:read", "portfolio:write"],
      },
      { stdio: true },
    );
    await server.connect(new StdioServerTransport());
    process.stdin.once("end", () => pool.end());
  }
} catch {
  console.error(
    "Startup failed. Verify HTTPS origin, issuer, subject allowlist, database access and migrations.",
  );
  await pool?.end();
  process.exitCode = 1;
}
