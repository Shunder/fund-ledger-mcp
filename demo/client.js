import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectDemo() {
  const client = new Client({ name: "fund-ledger-demo", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.js", import.meta.url))],
  });
  await client.connect(transport);
  return client;
}
export async function call(client, name, args) {
  const reply = await client.callTool({ name, arguments: args });
  if (reply.isError) throw Error(reply.content[0].text);
  return reply.structuredContent.result;
}
