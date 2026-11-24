import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../../demo/server.js", import.meta.url));
const stdio = { command: process.execPath, args: [server] };
const config = process.argv.includes("--vscode")
  ? { servers: { fund_ledger: { type: "stdio", ...stdio } } }
  : { mcpServers: { fund_ledger: stdio } };
console.log(JSON.stringify(config, null, 2));
