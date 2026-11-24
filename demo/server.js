import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { demoDatabase } from "./database.js";
import { baseline, positions, replayNav, period } from "./fixture.js";
import { migrate } from "../src/db.js";
import { edit } from "../src/store.js";
import { refresh } from "../src/sync.js";
import { catalog, mcpServer } from "../src/tools.js";

const pool = await demoDatabase();
const owner = "fictional-demo";
await migrate(pool);
// Even the optional snapshot NAV lookup must stay offline.
globalThis.fetch = async () => {
  throw Error("本地演示只使用内置净值");
};
for (const holding of positions)
  await edit(pool, owner, { action: "add", holding });
await refresh(pool, owner, { start: baseline, end: period.end }, replayNav);
const demoWrites = ["preview_portfolio_changes", "confirm_changes", "refresh_portfolio"];
const server = mcpServer(
  {
    pool,
    owner,
    scopes: ["portfolio:read", "portfolio:write"],
    navSource: replayNav,
  },
  {
    stdio: true,
    instructions:
      "这是随进程重置的虚构账本。最新回放日 2025-04-01，上个完整月份 2025-03。查询请显式传日期。展示写入预览后等待用户确认。",
    enabledTools: catalog.filter(
      (t) => demoWrites.includes(t.name) ||
        (!t.write && !t.open && !["search", "fetch"].includes(t.name)),
    ),
  },
);
await server.connect(new StdioServerTransport());
process.stdin.once("end", () => pool.end());
