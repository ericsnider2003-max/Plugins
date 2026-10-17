// Optional multi-device collector queue. It is local-only by default and does
// not send data to a network endpoint. Payloads are sanitized before storage.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { capturesToObservations } from "./provider-ingest.mjs";
import { appendObservation } from "./observation-ledger.mjs";

const SECRET = /token|secret|password|cookie|authorization|api[_-]?key|credential|access[_-]?token/i;
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
const time = (value) => { const n = Date.parse(value || ""); return Number.isFinite(n) ? n : null; };
function sanitize(value, key = "") {
  if (SECRET.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((x) => sanitize(x));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([k, v]) => [k, sanitize(v, k)]));
}

export function createCollectorEvent({ deviceId, provider = "unknown", surface = "unknown", capture, observedAt, receivedAt = new Date().toISOString() } = {}) {
  if (!deviceId || typeof deviceId !== "string") throw new Error("deviceId is required");
  if (!capture || typeof capture !== "object") throw new Error("capture is required");
  const safe = sanitize(capture); const observed = observedAt || safe.capturedAt || receivedAt;
  const eventId = `collector-${digest({ deviceId, provider, surface, observedAt: observed, capture: safe })}`;
  return { contract: "usage-max.collector-event.v1", eventId, deviceFingerprint: `sha256-${digest(deviceId)}`, provider, surface, observedAt: observed, receivedAt, clockSkewMs: time(receivedAt) !== null && time(observed) !== null ? time(receivedAt) - time(observed) : null, freshness: "unknown", capture: safe };
}

export function collectorFreshness(event, { now = Date.now(), maxAgeMs = EVIDENCE_FRESHNESS_MS } = {}) {
  const at = time(event?.observedAt); if (at === null) return { freshness: "unknown", ageMs: null };
  const ageMs = now - at; return { freshness: ageMs >= 0 && ageMs <= maxAgeMs ? "fresh" : "stale", ageMs };
}

export function appendCollectorEvent(file, event) {
  if (!event?.eventId) throw new Error("collector event is missing eventId");
  fs.mkdirSync(path.dirname(file), { recursive: true }); const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
  if (existing.some((line) => { try { return JSON.parse(line).eventId === event.eventId; } catch { return false; } })) return { appended: false, duplicate: true, event };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 }); return { appended: true, duplicate: false, event };
}

export function readCollectorEvents(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { const value = JSON.parse(line); return value?.contract === "usage-max.collector-event.v1" ? [value] : []; } catch { return []; } }); }
export function collectorQueueFile(home) { return path.join(home, ".usage-max", "collector-events.jsonl"); }
export function ingestCollectorQueue(queueFile, ledgerFile, { accountBindings = {}, accountSlots = {}, now = Date.now() } = {}) {
  const results = [];
  for (const event of readCollectorEvents(queueFile)) {
    const freshness = collectorFreshness(event, { now });
    const capture = { ...event.capture, source: event.capture?.source || "collector-device", capturedAt: event.observedAt };
    const binding = accountBindings[event.surface] || { slot: accountSlots[event.surface] || null, approved: false };
    const key = event.surface.includes("codex") ? "codex" : event.surface.includes("claude") ? "claude" : event.surface;
    const mapped = capturesToObservations({ [key]: capture }, { accountBindings: { [event.surface]: binding, [key]: binding }, accountSlots, capturedAt: event.receivedAt });
    for (const observation of mapped) {
      observation.data = { ...(observation.data || {}), collectorEventId: event.eventId, deviceFingerprint: event.deviceFingerprint, clockSkewMs: event.clockSkewMs, collectorFreshness: freshness.freshness };
      if (freshness.freshness !== "fresh") { observation.freshness = freshness.freshness; observation.state = observation.state === "governing" ? "observing" : observation.state; }
      results.push(appendObservation(ledgerFile, observation));
    }
  }
  return results;
}
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
