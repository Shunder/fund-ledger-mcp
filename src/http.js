import express from "express";
import { rateLimit } from "express-rate-limit";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { catalog, mcpServer, publicError } from "./tools.js";

function httpsOrigin(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw Error("CONFIG_HTTPS_ORIGIN");
  return u.origin;
}
export function config(env) {
  const origin = httpsOrigin(env.PUBLIC_ORIGIN),
    issuer = httpsOrigin(env.OAUTH_ISSUER) + "/";
  const allowed = (env.ALLOWED_SUBJECTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.length) throw Error("CONFIG_SUBJECTS");
  return {
    origin,
    issuer,
    allowed,
    resource: origin + "/mcp",
    webClientId: env.WEB_CLIENT_ID || "",
  };
}
export const ownerId = (issuer, sub) =>
  createHash("sha256")
    .update(JSON.stringify([issuer, sub]))
    .digest("hex");
export function appFor(
  pool,
  conf,
  jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", conf.issuer), {
    timeoutDuration: 4500,
  }),
) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  const metadata = conf.origin + "/.well-known/oauth-protected-resource/mcp";
  const scopes = ["portfolio:read", "portfolio:write"];
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' " +
        conf.issuer +
        "; frame-src " +
        conf.issuer +
        "; frame-ancestors 'none'; base-uri 'none'; form-action 'self' " +
        conf.issuer,
    });
    next();
  });
  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "database_unavailable" });
    }
  });
  // Peer IP comes from the socket. A shared reverse proxy may share this outer budget.
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 480,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      validate: { xForwardedForHeader: false, forwardedHeader: false },
    }),
  );
  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ],
    (req, res) =>
      res.json({
        resource: conf.resource,
        authorization_servers: [conf.issuer],
        scopes_supported: scopes,
        bearer_methods_supported: ["header"],
      }),
  );
  app.get("/web-config", (req, res) =>
    res.json({
      domain: new URL(conf.issuer).host,
      clientId: conf.webClientId,
      audience: conf.resource,
    }),
  );
  app.get("/manage", (req, res) =>
    res.sendFile(
      fileURLToPath(new URL("../public/manage.html", import.meta.url)),
    ),
  );
  app.get("/assets/auth.js", (req, res) =>
    res.sendFile(
      fileURLToPath(
        new URL(
          "../node_modules/@auth0/auth0-spa-js/dist/auth0-spa-js.production.js",
          import.meta.url,
        ),
      ),
    ),
  );
  app.use(
    "/assets",
    express.static(fileURLToPath(new URL("../public/", import.meta.url)), {
      index: false,
      dotfiles: "deny",
    }),
  );
  const challenge = (res, status, scope = "portfolio:read") =>
    res
      .status(status)
      .set(
        "WWW-Authenticate",
        'Bearer resource_metadata="' + metadata + '", scope="' + scope + '"',
      )
      .json({
        error: status === 401 ? "authentication_required" : "forbidden",
      });
  app.use(["/mcp", "/api"], async (req, res, next) => {
    if (req.headers.origin && req.headers.origin !== conf.origin)
      return res.sendStatus(403);
    if (Object.keys(req.query).length)
      return res.status(400).json({ error: "unexpected_query" });
    const token = req.headers.authorization?.match(
      /^Bearer ([^\s]{1,16384})$/i,
    )?.[1];
    if (!token) return challenge(res, 401);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: conf.issuer,
        audience: conf.resource,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
      });
      if (!conf.allowed.includes(payload.sub)) return challenge(res, 403);
      const granted =
        typeof payload.scope === "string" ? payload.scope.split(" ") : [];
      if (!granted.includes("portfolio:read")) return challenge(res, 403);
      req.ledger = {
        pool,
        origin: conf.origin,
        owner: ownerId(conf.issuer, payload.sub),
        scopes: granted,
        metadata,
      };
      next();
    } catch {
      return challenge(res, 401);
    }
  });
  app.use(
    ["/mcp", "/api"],
    rateLimit({
      windowMs: 60000,
      limit: 90,
      keyGenerator: (req) => req.ledger.owner,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    express.json({ limit: "128kb", strict: true }),
  );
  app.post("/api/tools/:name", async (req, res) => {
    const t = catalog.find((t) => t.name === req.params.name);
    if (!t) return res.sendStatus(404);
    if (t.write && !req.ledger.scopes.includes("portfolio:write"))
      return challenge(res, 403, "portfolio:read portfolio:write");
    try {
      return res.json({
        result: await t.run(req.ledger, t.schema.parse(req.body)),
      });
    } catch (e) {
      const error = publicError(e);
      res.status(error.code === "UNAVAILABLE" ? 503 : 400).json({ error });
    }
  });
  app.post("/mcp", async (req, res) => {
    const server = mcpServer(req.ledger);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (req, res) => res.set("Allow", "POST").sendStatus(405));
  app.use((err, req, res, next) => {
    if (!res.headersSent)
      res
        .status(err.status === 413 ? 413 : err.status === 400 ? 400 : 500)
        .json({ error: "request_failed" });
  });
  return app;
}
