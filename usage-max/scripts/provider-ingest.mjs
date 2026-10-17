// Convert provider-limits captures into the normalized ledger without enabling enforcement.
import path from "node:path";
import { claudeCaptureObservation, codexCaptureObservation, openaiCaptureObservation } from "./observation-adapters.mjs";
import { appendObservation } from "./observation-ledger.mjs";
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";

const freshness = (observation, capturedAt, maxAgeMs = EVIDENCE_FRESHNESS_MS) => {
  if (observation.freshness !== "fresh") return observation;
  const observed = Date.parse(observation.capturedAt || 0); const received = typeof capturedAt === "number" ? capturedAt : Date.parse(capturedAt || 0);
  if (!Number.isFinite(observed) || !Number.isFinite(received) || received < observed || received - observed > maxAgeMs) return { ...observation, freshness: "stale", state: observation.state === "governing" ? "observing" : observation.state, data: { ...observation.data, staleReason: "capture exceeded freshness window" } };
  return observation;
};

export function capturesToObservations(captures, { accountSlots = {}, accountBindings = {}, trustedProducers = {}, capturedAt = Date.now() } = {}) {
  const out = [];
  const claude = accountBindings.claude || { slot: accountSlots.claude || null, approved: false };
  const codex = accountBindings.codex || { slot: accountSlots.codex || null, approved: false };
  if (captures?.claude) out.push(claudeCaptureObservation(captures.claude, { accountSlot: claude.slot || null, approved: Boolean(claude.approved), capturedAt }));
  if (captures?.codex) out.push(codexCaptureObservation(captures.codex, { accountSlot: codex.slot || null, approved: Boolean(codex.approved), capturedAt }));
  for (const surface of ["chatgpt", "chatgpt-desktop"]) if (captures?.[surface]) {
    const binding = accountBindings[surface] || { slot: accountSlots[surface] || null, approved: false };
    out.push(openaiCaptureObservation(captures[surface], { surface, accountSlot: binding.slot || null, approved: Boolean(binding.approved), trustedProvider: trustedProducers[surface] === "browser-extension" && captures[surface]?.source === "openai-webmcp", capturedAt }));
  }
  if (captures?.cowork) {
    const surface = "cowork"; const binding = accountBindings[surface] || { slot: accountSlots[surface] || null, approved: false };
    out.push(claudeCaptureObservation(captures[surface], { surface, accountSlot: binding.slot || null, approved: Boolean(binding.approved), capturedAt, trustedProvider: false }));
  }
  return out.map((observation) => freshness(observation, capturedAt));
}

export function ingestCaptures(file, captures, options = {}) {
  const observations = capturesToObservations(captures, options);
  return observations.map((observation) => appendObservation(file, observation));
}

export function defaultObservationLedger(home) { return path.join(home, ".usage-max", "observations.jsonl"); }
