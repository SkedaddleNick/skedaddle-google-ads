// src/mcpAdsServer.ts
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

/** -------------------- ENV + AUTH -------------------- */
const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

function getAdsEnv() {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCid = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID; // MCC (optional but recommended)
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;     // client account
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION || "v17";
  if (!devToken) throw new Error("Missing GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!customerId) throw new Error("Missing GOOGLE_ADS_CUSTOMER_ID");
  return { devToken, loginCid, customerId, apiVersion };
}

async function getAccessToken() {
  const svcJson = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (svcJson) {
    const creds = JSON.parse(svcJson);
    const auth = new GoogleAuth({
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
      scopes: [ADS_SCOPE],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) throw new Error("Failed to obtain access token");
    return token.token;
  }

  if (clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
    const auth = new GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: [ADS_SCOPE],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token || !token.token) throw new Error("Failed to obtain access token");
    return token.token;
  }

  throw new Error(
    "Missing service account credentials. Set GOOGLE_ADS_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY."
  );
}

async function adsSearch({ gaql, pageSize = 1000 }: { gaql: string; pageSize?: number }) {
  const { devToken, loginCid, customerId, apiVersion } = getAdsEnv();
  const accessToken = await getAccessToken();
  const url = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:search`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken,
      "Content-Type": "application/json",
      ...(loginCid ? { "login-customer-id": loginCid } : {}),
    },
    body: JSON.stringify({ query: gaql, pageSize }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google Ads API error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<any>;
}

/** -------------------- Tool registry -------------------- */

type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: any; // JSON Schema for actions
  validate?: (input: unknown) => any;
  run: (input: any) => Promise<any>;
};

const tools: Record<string, ToolDef> = {};

// 1) Generic GAQL search
const zSearch = z.object({
  gaql: z.string().min(3, "GAQL query required"),
  pageSize: z.number().int().min(1).max(10000).default(1000),
});

tools["ads_search"] = {
  name: "ads_search",
  title: "Google Ads: GAQL Search",
  description: "Run a GAQL query against Google Ads (search).",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    properties: {
      gaql: { type: "string", description: "GAQL query string" },
      pageSize: { type: "integer", minimum: 1, maximum: 10000 },
    },
    required: ["gaql"],
  },
  validate: (input) => zSearch.parse(input),
  run: async (input) => {
    const args = zSearch.parse(input);
    const data = await adsSearch({ gaql: args.gaql, pageSize: args.pageSize });
    const rows = (data as any)?.results ?? [];
    return {
      content: [{ type: "text", text: `Returned ${rows.length} rows.` }],
      structuredContent: { rows },
    };
  },
};

// 2) Convenience: top campaigns by clicks last 7 days
const zTopCampaigns = z.object({
  limit: z.number().int().min(1).max(1000).default(10),
  dateRange: z
    .object({ startDate: z.string(), endDate: z.string() })
    .default({ startDate: "LAST_7_DAYS", endDate: "TODAY" }),
});

tools["ads_top_campaigns"] = {
  name: "ads_top_campaigns",
  title: "Google Ads: Top Campaigns (last 7 days)",
  description: "Returns top campaigns by clicks over the last 7 days.",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      dateRange: {
        type: "object",
        additionalProperties: false,
        properties: { startDate: { type: "string" }, endDate: { type: "string" } },
        required: ["startDate", "endDate"],
      },
    },
    required: [],
  },
  validate: (input) => zTopCampaigns.parse(input),
  run: async (input) => {
    const args = zTopCampaigns.parse(input);
    const start = args.dateRange.startDate;
    const end = args.dateRange.endDate;
    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${start}' AND '${end}'
      ORDER BY metrics.clicks DESC
      LIMIT ${args.limit}
    `;
    const data = await adsSearch({ gaql, pageSize: args.limit });
    const rows = (data as any)?.results ?? [];
    return {
      content: [{ type: "text", text: `Top ${rows.length} campaigns by clicks (${start}..${end}).` }],
      structuredContent: { rows },
    };
  },
};

/** -------------------- Exports consumed by /api/mcp.ts -------------------- */
export function listAdsTools() {
  // Expose as actions-compatible objects
  return Object.values(tools).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    input_schema: t.inputSchema,
    parameters: {
      type: "object",
      properties: t.inputSchema.properties || {},
      required: t.inputSchema.required || [],
      additionalProperties: false,
    },
  }));
}

export async function callAdsTool(name: string, args: any) {
  const t = tools[name];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  const parsed = t.validate ? t.validate(args) : args;
  return await t.run(parsed);
}
