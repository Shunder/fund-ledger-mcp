import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
} from "railway/iac";

export default defineRailway(() => {
  const db = postgres("Postgres");
  const web = service("web", {
    source: github("Shunder/fund-ledger-mcp", { branch: "main" }),
    start: "node src/index.js --http",
    healthcheck: "/health",
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      PUBLIC_ORIGIN: preserve(),
      OAUTH_ISSUER: preserve(),
      ALLOWED_SUBJECTS: preserve(),
      WEB_CLIENT_ID: preserve(),
      SCHEDULER_ENABLED: "true",
      TZ: "Asia/Shanghai",
    },
  });
  return project("fund-ledger-mcp", { resources: [db, web] });
});
