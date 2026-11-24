import { z } from "zod";
import { catalog } from "../src/tools.js";
console.log(
  JSON.stringify(
    catalog.map((t) => ({
      name: t.name,
      description: t.description,
      scope: t.write ? "portfolio:write" : "portfolio:read",
      readOnlyHint: !t.write,
      openWorldHint: t.open,
      destructiveHint: t.destructive,
      idempotentHint: t.idempotent,
      inputSchema: z.toJSONSchema(t.schema, {target:"draft-7", io:"input"}),
    })),
    null,
    2,
  ),
);
