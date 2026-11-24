import {
  defineRailway,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

export default defineRailway(() => {
  const web = service("fund-ledger-mcp", {
    source: github("Shunder/fund-ledger-mcp", { branch: "main" }),
    start: "node src/index.js --http",
    healthcheck: "/health",
    env: {
      DATABASE_URL: preserve(),
      PUBLIC_ORIGIN: preserve(),
      OAUTH_ISSUER: preserve(),
      ALLOWED_SUBJECTS: preserve(),
      WEB_CLIENT_ID: preserve(),
      SCHEDULER_ENABLED: "false",
      TZ: "Asia/Shanghai",
    },
  });
  return project("fund-ledger-mcp", { resources: [web] });
});
