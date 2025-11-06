// /api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listAdsTools, callAdsTool } from "../src/mcpAdsServer";

// Optional: respond to GETs at /api/mcp with a tiny help message
function getHelp() {
  return {
    mcp: true,
    message:
      'POST with {"method":"tools/list"} or {"method":"tools/call","name":"...","arguments":{...}}',
    endpoints: { list: "tools/list", call: "tools/call" },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      // also support ?method=tools/list for quick browser checks
      const q = (req.query?.method as string) || "";
      if (q === "tools/list") {
        const actions = listAdsTools();
        return res.status(200).json({ tools: actions, actions });
      }
      return res.status(200).json(getHelp());
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const jsonrpc = body?.jsonrpc ? "2.0" : null;
    const id = body?.id ?? null;
    const method = body?.method;

    if (!method) {
      const out = { error: "Missing 'method'." };
      return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error: out } : out);
    }

    if (method === "tools.list" || method === "tools/list") {
      const actions = listAdsTools();
      const result = { tools: actions, actions };
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }

    if (method === "tools.call" || method === "tools/call") {
      const name = body?.name;
      const args = body?.arguments ?? {};
      if (!name) {
        const out = { error: "Missing 'name' for tools.call." };
        return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error: out } : out);
      }
      const result = await callAdsTool(name, args);
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }

    // Fallback: show help
    const out = { error: `Unsupported method: ${method}`, ...getHelp() };
    return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error: out } : out);
  } catch (e: any) {
    const msg = e?.message || String(e);
    return res.status(500).json({ error: msg });
  }
}
