// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// IMPORTANT: keep the .js extension for ESM on Vercel
import { listAdsTools, callAdsTool } from "../src/mcpAdsServer.js";

function helpPayload() {
  return {
    mcp: true,
    message:
      'POST {"jsonrpc":"2.0","id":1,"method":"tools.list"} or {"jsonrpc":"2.0","id":1,"method":"tools.call","name":"...","arguments":{...}}',
    endpoints: { list: "tools.list / tools/list", call: "tools.call / tools/call" },
  };
}

// Minimal MCP initialize reply
function initializeResult() {
  return {
    protocolVersion: "2025-06-18", // acceptable MCP protocol version string
    serverInfo: { name: "skedaddle-google-ads-mcp", version: "1.0.0" },
    // Expose both "tools" and legacy "actions" to be safe
    capabilities: {
      tools: { list: true, call: true },
      actions: { list: true, call: true },
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Optional endpoint lock-down
    const token = process.env.MCP_BEARER_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Quick browser check
    if (req.method === "GET") {
      const q = (req.query?.method as string) || "";
      if (q === "tools/list" || q === "tools.list") {
        const actions = listAdsTools();
        return res.status(200).json({ tools: actions, actions });
      }
      return res.status(200).json(helpPayload());
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
      const error = { code: -32600, message: "Missing 'method' in request body." };
      return res.status(400).json(jsonrpc ? { jsonrpc: "2.0", id, error } : { error });
    }

    // --- MCP handshake methods ---
    if (method === "initialize") {
      const result = initializeResult();
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }
    if (method === "notifications/initialized") {
      const result = { acknowledged: true };
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }

    // --- Tools methods (both dotted and slashed forms) ---
    if (method === "tools.list" || method === "tools/list") {
      const actions = listAdsTools();
      const result = { tools: actions, actions };
      return res.status(200).json(jsonrpc ? { jsonrpc: "2.0", id, result } : result);
    }

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
