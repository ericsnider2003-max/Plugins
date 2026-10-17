#!/usr/bin/env node
// Read-only Streamable HTTP transport for ChatGPT custom MCP connections.
// The server is loopback-only by default. Use Secure MCP Tunnel or an
// explicitly protected reverse proxy before exposing it to ChatGPT.
import http from "node:http";
import { dispatch } from "./usage-max-mcp-server.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const maxBody = 128 * 1024;

function headers(res, corsOrigin = null) {
  res.setHeader("content-type", "application/json");
  if (corsOrigin) { res.setHeader("access-control-allow-origin", corsOrigin); res.setHeader("access-control-allow-methods", "POST,GET,OPTIONS"); res.setHeader("access-control-allow-headers", "content-type,authorization"); }
}
function authorized(req, token) { return Boolean(token) && req.headers.authorization === `Bearer ${token}`; }
function send(res, status, body, corsOrigin = null) { headers(res, corsOrigin); res.statusCode = status; res.end(body === undefined ? "" : JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ""; req.on("data", (chunk) => { body += chunk; if (Buffer.byteLength(body) > maxBody) { reject(new Error("payload too large")); req.destroy(); } }); req.on("end", () => resolve(body)); req.on("error", reject); }); }

export function createMcpHttpServer({ host = "127.0.0.1", token = null, corsOrigin = null } = {}) {
  if (host !== "127.0.0.1" && host !== "::1" && !token) throw new Error("MCP HTTP token is required for non-loopback hosts");
  return http.createServer(async (req, res) => {
    if (req.url !== "/mcp") { if (req.method === "GET" && req.url === "/") return send(res, 200, { name: "usage-max", transport: "streamable-http", readOnly: true, host }, corsOrigin); return send(res, 404, { error: "not found" }, corsOrigin); }
    if (req.method === "OPTIONS") return send(res, 204, undefined, corsOrigin);
    if (!authorized(req, token)) return send(res, 401, { error: "authorization required" }, corsOrigin);
    if (req.method !== "POST") return send(res, 405, { error: "POST required" }, corsOrigin);
    try {
      const message = JSON.parse(await readBody(req)); const response = dispatch(message);
      if (!response) return send(res, 202, undefined, corsOrigin);
      res.setHeader("MCP-Protocol-Version", "2024-11-05"); return send(res, 200, response, corsOrigin);
    } catch (error) { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: `Usage-max MCP HTTP request failed: ${String(error?.message || error)}` } }, corsOrigin); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const host = process.env.USAGE_MAX_MCP_HTTP_HOST || "127.0.0.1"; const port = Number(process.env.USAGE_MAX_MCP_HTTP_PORT || 8787); const token = process.env.USAGE_MAX_MCP_HTTP_TOKEN || null; const corsOrigin = process.env.USAGE_MAX_MCP_HTTP_CORS_ORIGIN || null;
  const server = createMcpHttpServer({ host, token, corsOrigin }); server.listen(port, host, () => process.stdout.write(`usage-max MCP HTTP listening on http://${host}:${port}/mcp\n`));
  const stop = () => server.close(() => process.exit(0)); process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
