#!/usr/bin/env node
import assert from "node:assert/strict";
import http from "node:http";
import { createMcpHttpServer } from "../mcp/usage-max-mcp-http-server.mjs";
assert.throws(() => createMcpHttpServer({ host: "0.0.0.0" }), /token is required/);

const server = createMcpHttpServer({ token: "test-http-token" });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
function request({ method = "GET", path = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}), ...headers } }, (res) => { let text = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null })); });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
const health = await request(); assert.equal(health.status, 200); assert.equal(health.body.readOnly, true); assert.equal(health.body.transport, "streamable-http");
const denied = await request({ method: "POST", path: "/mcp", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }); assert.equal(denied.status, 401);
const init = await request({ method: "POST", path: "/mcp", headers: { authorization: "Bearer test-http-token" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) }); assert.equal(init.status, 200); assert.equal(init.body.result.serverInfo.name, "usage-max-mcp-server"); assert.equal(init.headers["mcp-protocol-version"], "2024-11-05");
const tools = await request({ method: "POST", path: "/mcp", headers: { authorization: "Bearer test-http-token" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) }); assert.equal(tools.status, 200); assert.ok(tools.body.result.tools.some((tool) => tool.name === "usage_max_get_status"));
const resource = await request({ method: "POST", path: "/mcp", headers: { authorization: "Bearer test-http-token" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "usage-max://status" } }) }); assert.equal(resource.status, 200); assert.match(resource.body.result.contents[0].text, /enforcementEnabled/);
const notification = await request({ method: "POST", path: "/mcp", headers: { authorization: "Bearer test-http-token" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }); assert.equal(notification.status, 202);
server.close(); console.log("MCP HTTP server tests passed");
