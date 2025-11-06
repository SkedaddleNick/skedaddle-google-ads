// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// IMPORTANT: keep the ".js" here (Vercel compiles TS to JS and Node ESM needs the extension)
import { listAdsTools, callAdsTool } from "../src/mcpAdsServer.js";

/**
 * Small helper response used by GET /api/mcp and unsupported methods.
 */
function helpPayload() {
  return {
    mcp: true,
    message:
      'POST {"jsonrpc":"2.0","id":1,"method":"tools.list"} or {"jsonrpc":"2.0","id":1,"method":"tools.call","name":"...","arguments":{...}}',
    endpoints: { list: "tools.list / tools/list", call: "tools.call / tools/call" },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Simple GET support for quick browser checks:
    //  - /api/mcp                -> help
    //  - /api/mcp?method=tools/list -> returns tools
    if (req.method === "GET") {
      const methodQ = (req.query?.method as string) || "";
      if (methodQ === "tools/list" || methodQ === "tools.list") {
        const actions = listAdsTools();
        return res.status(200).json({ tools: actions, actions });
      }
      return res.status(200).json(helpPayload());
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // Body can arrive parsed or as a string depending on platform
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const jsonrpc = body?.jsonrpc ? "2.0" : null;
    const id = body?.id ?? null;
    const method = body?.method;

    if (!method) {
      const error = { code: -32600, message: "Missing 'method' in request body." };
      return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error } : { error });
    }

    // List tools
    if (method === "tools.list" || method === "tools/list") {
      const actions = listAdsTools();
      const result = { tools: actions, actions };
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }

    // Call a tool
    if (method === "tools.call" || method === "tools/call") {
      const name = body?.name;
      const args = body?.arguments ?? {};
      if (!name) {
        const error = { code: -32602, message: "Missing 'name' for tools.call." };
        return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error } : { error });
      }

      try {
        const result = await callAdsTool(name, args);
        return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
      } catch (e: any) {
        const error = { code: -32000, message: e?.message || String(e) };
        return res.status(500).json(jsonrpc ? { jsonrpc: "2.0", id, error } : { error });
      }
    }

    // Fallback
    const error = { code: -32601, message: `Unsupported method: ${method}` };
    return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error, ...helpPayload() } : { error, ...helpPayload() });
  } catch (e: any) {
    const error = { code: -32000, message: e?.message || String(e) };
    return res.status(500).json({ error });
  }
}
