// api/mcp.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// IMPORTANT for ESM on Vercel – keep .js extension if your build outputs ESM
import { listAdsTools, callAdsTool } from "../src/mcpAdsServer.js";

/** Small help payload for GETs / debugging */
function helpPayload() {
  return {
    mcp: true,
    message:
      'POST {"jsonrpc":"2.0","id":1,"method":"tools.list"} or {"jsonrpc":"2.0","id":1,"method":"tools.call","name":"...","arguments":{...}}',
    endpoints: { list: "tools.list / tools/list", call: "tools.call / tools/call" },
  };
}

/** Minimal MCP initialize result */
function initializeResult() {
  return {
    protocolVersion: "2025-06-18", // acceptable protocol string
    serverInfo: { name: "skedaddle-google-ads-mcp", version: "1.0.0" },
    // Expose both tools + legacy actions for maximum compatibility
    capabilities: {
      tools: { list: true, call: true },
      actions: { list: true, call: true },
    },
  };
}

/** Log helpers that won’t crash render if body isn’t JSON */
function safeStringify(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function logRequest(tag: string, payload: any) {
  console.log(`=== ${tag} ===`);
  console.log(safeStringify(payload));
  console.log("=== end ===");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── Optional endpoint lock-down via Bearer token ─────────────────────────────
  const gate = process.env.MCP_BEARER_TOKEN;
  if (gate && req.headers.authorization !== `Bearer ${gate}`) {
    console.warn("Unauthorized request (missing/invalid bearer).");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Simple browser GETs: show help or tool list ──────────────────────────────
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

  // ── Parse and log incoming JSON-RPC body ─────────────────────────────────────
  // Vercel may already give an object; if it's a string, parse it.
  let body: any = req.body;
  try {
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (body == null || typeof body !== "object") body = {};
  } catch (err) {
    console.warn("Failed to parse request body:", err);
    body = {};
  }

  logRequest("MCP Request", {
    method: body?.method,
    id: body?.id,
    hasJsonRpc: !!body?.jsonrpc,
    preview: body, // full payload for debugging
  });

  const jsonrpc = body?.jsonrpc ? "2.0" : null;
  const id = body?.id ?? null;
  const method = body?.method;

  // Helper to send JSON-RPC reply (HTTP 200 even for JSON-RPC errors)
  function sendResult(result: any) {
    const payload = jsonrpc ? { jsonrpc: "2.0", id, result } : result;
    logRequest("MCP Reply (result)", payload);
    return res.status(200).json(payload);
  }
  function sendError(code: number, message: string, extra?: any) {
    const error = { code, message, ...(extra || {}) };
    const payload = jsonrpc ? { jsonrpc: "2.0", id, error } : { error };
    logRequest("MCP Reply (error)", payload);
    return res.status(jsonrpc ? 200 : 400).json(payload);
  }

  // ── Routing ──────────────────────────────────────────────────────────────────
  try {
    if (!method) {
      return sendError(-32600, "Missing 'method' in request body.");
    }

    // MCP handshake
    if (method === "initialize") {
      return sendResult(initializeResult());
    }
    if (method === "notifications/initialized") {
      return sendResult({ acknowledged: true });
    }

    // Tools list (support dotted + slashed)
    if (method === "tools.list" || method === "tools/list") {
      const actions = listAdsTools();
      return sendResult({ tools: actions, actions });
    }

    // Tools call (support dotted + slashed)
    if (method === "tools.call" || method === "tools/call") {
      const name = body?.name;
      const args = body?.arguments ?? {};
      if (!name) {
        return sendError(-32602, "Missing 'name' for tools.call.");
      }

      try {
        const result = await callAdsTool(name, args);
        return sendResult(result);
      } catch (e: any) {
        return sendError(-32000, e?.message || String(e));
      }
    }

    // Fallback
    return sendError(-32601, `Unsupported method: ${method}`, helpPayload());
  } catch (e: any) {
    // Catastrophic / unexpected failure
    console.error("Unhandled MCP error:", e);
    const payload = { error: { code: -32000, message: e?.message || String(e) } };
    logRequest("MCP Reply (fatal)", payload);
    return res.status(500).json(jsonrpc ? { jsonrpc: "2.0", id, ...payload } : payload);
  }
}
