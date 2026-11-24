import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { Agent } from "undici";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { poolFor, migrate } from "../src/db.js";
import { appFor, config, ownerId } from "../src/http.js";
import { edit, confirm, eventsFor } from "../src/store.js";
import { refresh } from "../src/sync.js";
import { catalog } from "../src/tools.js";

let admin,
  pool,
  dbUrl,
  dir,
  agent,
  keySet,
  signing,
  server,
  origin,
  conf,
  schema;
const subjects = ["test|alpha", "test|beta"];
const h = {
  platform: "虚构账户",
  code: "000123",
  shares: "100",
  cost: "100",
  day: "2025-04-01",
};
const args = () => ({ action: "add", holding: h });
const owner = (s) => ownerId("https://issuer.invalid/", s);
const authFetch = (url, init) => fetch(url, { ...init, dispatcher: agent });
async function launch() {
  const opts = {
    key: await readFile(path.join(dir, "key.pem")),
    cert: await readFile(path.join(dir, "cert.pem")),
  };
  server = https.createServer(opts);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "https://127.0.0.1:" + server.address().port;
  conf = config({
    PUBLIC_ORIGIN: origin,
    OAUTH_ISSUER: "https://issuer.invalid",
    ALLOWED_SUBJECTS: subjects.join(","),
    WEB_CLIENT_ID: "ci-spa",
  });
  server.on("request", appFor(pool, conf, keySet));
}
async function stop() {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
async function token(
  sub,
  scope = "portfolio:read portfolio:write",
  aud = conf.resource,
) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setSubject(sub)
    .setIssuer(conf.issuer)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signing.privateKey);
}
async function client(sub, scope) {
  const c = new Client({ name: "integration", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(conf.resource), {
      fetch: authFetch,
      requestInit: {
        headers: { Authorization: "Bearer " + (await token(sub, scope)) },
      },
    }),
  );
  return c;
}
before(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw Error("Set TEST_DATABASE_URL to a disposable PostgreSQL database");
  admin = poolFor(process.env.TEST_DATABASE_URL);
  schema = "ledger_test_" + randomBytes(6).toString("hex");
  await admin.query("CREATE SCHEMA " + schema);
  const u = new URL(process.env.TEST_DATABASE_URL);
  u.searchParams.set("options", "-c search_path=" + schema);
  dbUrl = u.href;
  pool = poolFor(dbUrl);
  await Promise.all([migrate(pool), migrate(pool)]);
  dir = await mkdtemp(path.join(tmpdir(), "ledger-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      path.join(dir, "key.pem"),
      "-out",
      path.join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  agent = new Agent({
    connect: { ca: await readFile(path.join(dir, "cert.pem")) },
  });
  signing = await generateKeyPair("RS256");
  keySet = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(signing.publicKey)), kid: "fixture", alg: "RS256" },
    ],
  });
  await launch();
});
after(async () => {
  if (server?.listening) await stop();
  await agent?.close();
  await pool?.end();
  if (admin) {
    if (schema) await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});
test("HTTPS health, management UI, OAuth discovery, missing/incorrect audience and unlisted subject", async () => {
  for (const p of ["/health", "/manage", "/assets/auth.js", "/web-config"])
    assert.equal((await authFetch(origin + p)).status, 200);
  const anonymous = await authFetch(conf.resource, { method: "POST" });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("WWW-Authenticate"), /resource_metadata/);
  const metadata = await (
    await authFetch(origin + "/.well-known/oauth-protected-resource/mcp")
  ).json();
  assert.equal(metadata.resource, conf.resource);
  for (const [sub, aud, status] of [
    [subjects[0], "elsewhere", 401],
    ["stranger", conf.resource, 403],
  ]) {
    assert.equal(
      (
        await authFetch(conf.resource, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + (await token(sub, undefined, aud)),
          },
        })
      ).status,
      status,
    );
  }
  assert.equal(
    (await authFetch(origin + "/api/tools/get_portfolio", { method: "POST" }))
      .status,
    401,
  );
});
test("standard MCP client negotiates over TLS, lists annotations, validates writes and isolates users", async () => {
  const a = await client(subjects[0]),
    b = await client(subjects[1]),
    ro = await client(subjects[0], "portfolio:read");
  try {
    const { tools } = await a.listTools();
    assert.equal(tools.length, catalog.length);
    for (const t of tools) {
      assert.equal(t.inputSchema.type, "object");
      assert.ok(t.annotations);
      assert.ok(t._meta.securitySchemes);
      if (!t.annotations.readOnlyHint)
        assert.deepEqual(t._meta.securitySchemes[0].scopes, [
          "portfolio:read",
          "portfolio:write",
        ]);
    }
    assert.equal(
      tools.find((t) => t.name === "confirm_changes").annotations
        .destructiveHint,
      true,
    );
    const run = (cl, name, args) => cl.callTool({ name, arguments: args });
    assert.equal((await run(ro, "add_holding", { holding: h })).isError, true);
    assert.equal(
      (await run(a, "add_holding", { holding: { ...h, day: undefined } }))
        .isError,
      true,
    );
    assert.ok(!(await run(a, "add_holding", { holding: h })).isError);
    assert.equal(
      JSON.parse(
        (await run(a, "get_holding", { code: h.code })).content[0].text,
      ).combinedShares,
      "100",
    );
    assert.equal(
      JSON.parse((await run(b, "get_portfolio", {})).content[0].text).fundCount,
      0,
    );
    const p = JSON.parse(
      (await run(a, "update_holding", { holding: { ...h, shares: "90" } }))
        .content[0].text,
    );
    assert.equal(
      (await run(b, "confirm_changes", { token: p.token })).isError,
      true,
    );
    assert.ok(!(await run(a, "confirm_changes", { token: p.token })).isError);
  } finally {
    await Promise.all([a.close(), b.close(), ro.close()]);
  }
});
test("concurrent idempotence, atomic duplicate CSV imports, stale preview and delete confirmation", async () => {
  const o = "import-test",
    p = await edit(
      pool,
      o,
      {
        action: "import",
        data: {
          csv: "platform,code,day,shares,cost\n模拟,000123,2025-04-01,100,95",
        },
      },
      true,
    );
  const results = await Promise.all([
    confirm(pool, o, p.token),
    confirm(pool, o, p.token),
  ]);
  assert.deepEqual(...results);
  assert.equal((await eventsFor(pool, o)).length, 1);
  const duplicate = await edit(
    pool,
    o,
    {
      action: "import",
      data: { rows: [{ ...h, platform: "模拟", cost: "95" }] },
    },
    true,
  );
  assert.equal((await confirm(pool, o, duplicate.token)).unchanged, true);
  await assert.rejects(
    edit(pool, o, { action: "import", data: { rows: [h, h] } }, true),
  );
  const del = await edit(
    pool,
    o,
    { action: "delete_holding", platform: "模拟", code: h.code },
    true,
  );
  await Promise.all([edit(pool, o, args()), edit(pool, o, args())]);
  await assert.rejects(confirm(pool, o, del.token));
  const updated = await edit(
    pool,
    o,
    { action: "delete_record", id: results[0].saved[0] },
    true,
  );
  assert.equal((await confirm(pool, o, updated.token)).deleted.length, 1);
});
test("pending -> confirmed transition, idempotent sync, backfill, failure status, partial disclosures and snapshot invalidation", async () => {
  const o = "sync-test";
  await edit(pool, o, args());
  const t = {
    kind: "buy",
    id: "t1",
    platform: h.platform,
    name: "虚构指数",
    amount: "11",
    status: "pending",
    orderDay: h.day,
  };
  await edit(pool, o, { action: "record", transaction: t });
  await edit(pool, o, {
    action: "record",
    transaction: {
      ...t,
      status: "confirmed",
      code: h.code,
      day: "2025-04-02",
      shares: "10",
      nav: "1.1",
    },
  });
  assert.equal((await eventsFor(pool, o)).length, 2);
  const source = async (code, start, end) =>
    [
      { code, day: "2025-04-01", nav: "1" },
      { code, day: "2025-04-02", nav: "1.1" },
    ].filter((q) => q.day >= start && q.day <= end);
  const dates = { start: "2025-04-01", end: "2025-04-03" };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await refresh(pool, o, dates, source)).funds[0].status,
      "awaiting_nav",
    );
  const snap = await pool.query(
    "SELECT day,report FROM daily_snapshots WHERE owner=$1 ORDER BY day",
    [o],
  );
  assert.equal(snap.rowCount, 3);
  assert.equal(snap.rows[1].report.dailyProfit, "10.00");
  assert.equal(snap.rows[2].report.dailyProfit, null);
  const fail = await refresh(
    pool,
    o,
    { start: "2025-04-04", end: "2025-04-04" },
    async () => {
      throw Error("fixture_timeout");
    },
  );
  assert.equal(fail.status, "partial_failure");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM sync_logs WHERE owner=$1 AND status='source_error'",
        [o],
      )
    ).rowCount,
    1,
  );
  const update = await edit(
    pool,
    o,
    { action: "update", holding: { ...h, shares: "80" } },
    true,
  );
  await confirm(pool, o, update.token);
  assert.equal(
    (await pool.query("SELECT 1 FROM daily_snapshots WHERE owner=$1", [o]))
      .rowCount,
    0,
  );
});
test("restarted HTTP app and a fresh stdio process read the same isolated PostgreSQL holding", async () => {
  await stop();
  await pool.end();
  pool = poolFor(dbUrl);
  await migrate(pool);
  await launch();
  const c = await client(subjects[0]);
  const a = await c.callTool({ name: "get_portfolio", arguments: {} });
  await c.close();
  assert.equal(JSON.parse(a.content[0].text).holdings[0].shares, "90");
  const stdio = new Client({ name: "stdio-test", version: "1" });
  try {
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["src/index.js"],
        env: {
          DATABASE_URL: dbUrl,
          PUBLIC_ORIGIN: origin,
          OAUTH_ISSUER: conf.issuer,
          ALLOWED_SUBJECTS: subjects[0],
          STDIO_SUBJECT: subjects[0],
        },
      }),
    );
    const r = await stdio.callTool({ name: "get_portfolio", arguments: {} });
    assert.equal(JSON.parse(r.content[0].text).holdings[0].shares, "90");
  } finally {
    await stdio.close();
  }
});
test("same-day disclosed NAV fills missing shares and records source; other-day NAV is never substituted", async () => {
  const o = "derive-fixture";
  await pool.query(
    "INSERT INTO fund_nav_history(code,day,nav) VALUES('000777','2025-04-01',1.25)",
  );
  const holding = {
    platform: "虚构平台",
    code: "000777",
    marketValue: "125",
    unitCost: "1.1",
    day: "2025-04-01",
  };
  await edit(pool, o, { action: "add", holding });
  const [r] = await eventsFor(pool, o);
  assert.equal(r.shares, "100");
  assert.equal(r.cost, "110");
  assert.equal(r.estimated, true);
  assert.match(r.basis.join(" "), /披露单位净值/);
});
test("durable job slots suppress duplicate execution and retain the prior Shanghai target day", async () => {
  const { scheduledRun } = await import("../src/schedule.js");
  const calls = [],
    now = new Date("2025-04-04T00:15:00Z");
  const runner = async (p, o, range) => {
    calls.push(range.end);
    return { status: "finished" };
  };
  await scheduledRun(pool, now, runner);
  const count = calls.length;
  await scheduledRun(pool, now, runner);
  assert.ok(count > 0);
  assert.equal(calls.length, count);
  assert.ok(calls.every((d) => d === "2025-04-03"));
});
test("read-only browser API cannot write, authenticated browser preview/commit shares the MCP ledger", async () => {
  const endpoint = origin + "/api/tools/";
  const call = async (name, args, scope) =>
    authFetch(endpoint + name, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await token(subjects[1], scope)),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  assert.equal(
    (await call("add_holding", { holding: h }, "portfolio:read")).status,
    403,
  );
  const p = (
    await (
      await call("preview_portfolio_changes", { operation: args() })
    ).json()
  ).result;
  assert.equal((await call("confirm_changes", { token: p.token })).status, 200);
  const c = await client(subjects[1], "portfolio:read");
  try {
    const r = await c.callTool({ name: "fetch", arguments: { id: h.code } });
    assert.equal(r.structuredContent.result.id, h.code);
    assert.match(r.structuredContent.result.text, /虚构账户/);
  } finally {
    await c.close();
  }
});
