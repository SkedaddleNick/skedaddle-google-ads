// Merge handler stub
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listTools as listGa4, callTool as callGa4 } from "../src/mcpServer.js";
import { listAdsTools, callAdsTool } from "../src/mcpAdsServer.js";
// merge logic same as GA4 version
