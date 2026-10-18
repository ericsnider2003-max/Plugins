// Loopback-only receiver for trusted browser/desktop adapters. It accepts
// normalized, credential-free captures and writes the normal attachment file.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { attachmentDirectory } from "./attachments.mjs";
import { acknowledgeOutbox, readOutbox } from "./notification-bridge.mjs";
import { findSurface } from "./surface-adapters.mjs";
import { adapterId, loadAdapterPolicy } from "./adapter-policy.mjs";
import { looksSecret } from "./memory.mjs";

const allowed = new Set(["claude-code", "claude-desktop", "codex-cli", "codex-desktop", "chatgpt", "chatgpt-desktop", "cowork"]);
const noticeFile = (home) => path.join(home, ".usage-max", "notifications.jsonl");
const secret = /token|cookie|authorization|password|credential|access[_-]?key|secret/i;
const extensionIdPattern = /^[a-p]{32}$/i;
function configuredExtensionOrigin(extensionId, origin) {
  if (!extensionIdPattern.test(String(extensionId || ""))) return false;
  return origin === `chrome-extension://${String(extensionId).toLowerCase()}` || origin === `edge-extension://${String(extensionId).toLowerCase()}`;
}
function hasSecret(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => secret.test(k) || (typeof v === "string" && looksSecret(v)) || (v && typeof v === "object" && hasSecret(v)));
}
function tokenFile(home) { return path.join(home, ".usage-max", "attachment-server.token"); }
function extensionIdFile(home) { return path.join(home, ".usage-max", "browser-extension-id"); }
function configuredExtensionId(home, explicit = null) {
  if (explicit) return String(explicit).trim().toLowerCase();
  if (process.env.USAGE_MAX_BROWSER_EXTENSION_ID) return String(process.env.USAGE_MAX_BROWSER_EXTENSION_ID).trim().toLowerCase();
  try { return fs.readFileSync(extensionIdFile(home), "utf8").trim().toLowerCase(); } catch { return ""; }
}
function getToken(home) { const f = tokenFile(home); try { const token = fs.readFileSync(f, "utf8").trim(); if (token) return token; } catch {} const token = crypto.randomBytes(24).toString("base64url"); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${token}\n`, { encoding: "utf8", mode: 0o600 }); return token; }
function writeEnvelope(home, envelope) { const file = path.join(attachmentDirectory(home), `${envelope.surface}.json`); fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; try { fs.writeFileSync(tmp, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600 }); fs.renameSync(tmp, file); } catch (error) { try { fs.unlinkSync(tmp); } catch {} throw error; } return file; }
export function startAttachmentServer({ home = os.homedir(), port = 0, host = "127.0.0.1", extensionId = null } = {}) {
  extensionId = configuredExtensionId(home, extensionId);
  const token = getToken(home);
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const origin = String(req.headers.origin || "");
    if (configuredExtensionOrigin(extensionId, origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type,authorization,x-usage-max-producer");
      res.setHeader("vary", "Origin");
    }
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (req.method === "GET" && req.url === "/health") { res.end(JSON.stringify({ ok: true, mode: "credential-free-attachment-receiver" })); return; }
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; res.end(JSON.stringify({ error: "unauthorized" })); return; }
    if (req.method === "GET" && req.url?.startsWith("/v1/notifications")) {
      const surface = new URL(req.url, "http://127.0.0.1").searchParams.get("surface") || "unknown";
      const notices = readOutbox(noticeFile(home)).filter((x) => !x.deliveredAt && (!x.surface || x.surface === surface || x.surface === "all"));
      res.end(JSON.stringify({ notices: notices.slice(0, 20).map(({ noticeId, kind, message, createdAt }) => ({ noticeId, kind, message, createdAt })) })); return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/capabilities")) {
      const surface = new URL(req.url, "http://127.0.0.1").searchParams.get("surface") || "unknown"; const definition = findSurface(surface); const id = adapterId(surface); const policy = loadAdapterPolicy(home).adapters[id] || null;
      const adapter = policy ? { id, enabled: policy.enabled, permissions: policy.permissions, sources: policy.sources, authority: policy.authority, retention: policy.retention } : { id, enabled: false, reason: "no adapter policy" };
      res.end(JSON.stringify({ surface, provider: definition.provider, declared: { observation: definition.observation, notification: definition.notification, control: definition.control, taskLaunch: definition.taskLaunch, handoff: definition.handoff, checkpointInjection: definition.checkpointInjection, resume: definition.resume }, effective: { adapterEnabled: adapter.enabled === true, observation: adapter.enabled === true ? definition.observation : "disabled", notification: adapter.enabled === true ? definition.notification : "disabled", control: "unavailable", taskLaunch: "unavailable", handoff: "unavailable", checkpointInjection: "unavailable", resume: "unavailable" }, adapter })); return;
    }
    if (req.method === "POST" && req.url === "/v1/notifications/ack") {
      let size = 0; let body = ""; req.on("data", (chunk) => { size += chunk.length; if (size <= 32 * 1024) body += chunk; });
      req.on("end", () => { try { if (size > 32 * 1024) throw new Error("payload too large"); const value = JSON.parse(body); if (!Array.isArray(value.noticeIds)) throw new Error("noticeIds are required"); res.end(JSON.stringify(acknowledgeOutbox(noticeFile(home), value.noticeIds))); } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ acknowledged: 0, error: String(error.message || error) })); } }); return;
    }
    if (req.method !== "POST" || req.url !== "/v1/attachment") { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); return; }
    if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) { res.statusCode = 415; res.end(JSON.stringify({ error: "content-type must be application/json" })); return; }
    let size = 0; let body = ""; req.on("data", (chunk) => { size += chunk.length; if (size <= 128 * 1024) body += chunk; });
    req.on("end", () => { try { if (size > 128 * 1024) throw new Error("payload too large"); const envelope = JSON.parse(body); if (!allowed.has(envelope.surface)) throw new Error("unsupported surface"); if (!envelope.capture || typeof envelope.capture !== "object") throw new Error("capture is required"); if (hasSecret(envelope)) throw new Error("credential-like fields are refused"); const producer = envelope.surface === "chatgpt-desktop" && configuredExtensionOrigin(extensionId, origin) && String(req.headers["x-usage-max-producer"] || "") === "browser-extension" ? "browser-extension" : null; const file = writeEnvelope(home, { surface: envelope.surface, capture: envelope.capture, receivedAt: new Date().toISOString(), source: "loopback-host-attachment", ...(producer ? { producer } : {}) }); res.end(JSON.stringify({ accepted: true, file, producer })); } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ accepted: false, error: String(error.message || error) })); } });
  });
  server.listen(port, host);
  return { server, token, address: () => server.address() };
}
