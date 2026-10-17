// Pure adapter normalization. Network and credentials remain in provider-limits.mjs.
import { identifyModel } from "./identity.mjs";
const iso = (value) => { if (typeof value === "string" && Number.isNaN(Number(value))) return new Date(value).toISOString(); const n = Number(value); return new Date((Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.now())).toISOString(); };
const first = (...xs) => xs.find((x) => x !== undefined && x !== null);
const modelEnvelope = (capture, surface) => { const m = identifyModel(capture || {}, { surface }); return { provider: m.provider, raw: m.rawId, canonical: m.canonicalId, known: m.known, family: m.family, effort: m.effort }; };
export function claudeCaptureObservation(capture, { accountSlot = null, approved = false, surface = "claude-code", capturedAt = Date.now(), trustedProvider = true } = {}) {
  const limits = capture?.rate_limits || {};
  const firstWindow = Object.entries(limits)[0];
  const [id, win] = firstWindow || [];
  const model = modelEnvelope(capture, surface); const authority = trustedProvider ? "provider" : "unattributed"; return { contract: "usage-max.observation.v1", observationId: `claude-${capture?.capturedAt || iso(capturedAt)}`, provider: "anthropic", surface, source: capture?.source || "claude-api", account: accountSlot ? { slot: accountSlot, approved } : null, capturedAt: capture?.capturedAt || iso(capturedAt), providerEventAt: trustedProvider ? (capture?.capturedAt || null) : null, authority, state: trustedProvider && approved && accountSlot && model.provider === "anthropic" ? "governing" : "observing", freshness: "fresh", confidence: trustedProvider ? "measured" : "derived", window: win ? { id, kind: id, resetsAt: win.resets_at ? iso(win.resets_at) : null, usedPercentage: first(win.used_percentage, null) } : null, model, data: { limitCount: Object.keys(limits).length, authorityBasis: trustedProvider ? "trusted-provider-adapter" : "unverified-attachment" } };
}
export function codexCaptureObservation(capture, { accountSlot = null, approved = false, surface = "codex-cli", capturedAt = Date.now() } = {}) {
  const source = capture?.source || "codex-rollout";
  const providerRead = source === "codex-app-server";
  const [id, limit] = Object.entries(capture?.rate_limits || {})[0] || [];
  const model = modelEnvelope(capture, surface); return { contract: "usage-max.observation.v1", observationId: `codex-${capture?.capturedAt || iso(capturedAt)}`, provider: "openai", surface, source, account: accountSlot ? { slot: accountSlot, approved } : null, capturedAt: capture?.capturedAt || iso(capturedAt), providerEventAt: capture?.providerEventAt || (providerRead ? capture?.capturedAt || null : null), authority: providerRead ? "provider" : "local-activity", state: providerRead && approved && accountSlot && model.provider === "openai" ? "governing" : "observing", freshness: providerRead ? "fresh" : "unknown", confidence: providerRead ? "measured" : "derived", window: limit ? { id, kind: limit.label || id, resetsAt: limit.resets_at ? iso(limit.resets_at) : null, usedPercentage: limit.used_percentage ?? null } : null, model, data: { rate_limits: capture?.rate_limits || {} } };
}
export function openaiCaptureObservation(capture, { accountSlot = null, approved = false, surface = "chatgpt", capturedAt = Date.now(), trustedProvider = false } = {}) {
  const limits = capture?.rate_limits || capture?.rateLimits || {};
  const [id, limit] = Object.entries(limits)[0] || [];
  const visible = capture?.source === "browser-visible";
  const model = modelEnvelope(capture, surface);
  if (visible && capture?.effort && !model.effort) model.effort = capture.effort;
  const providerTrusted = trustedProvider === true && !visible; const authority = providerTrusted ? "provider" : "unattributed"; return { contract: "usage-max.observation.v1", observationId: `${surface}-${capture?.capturedAt || iso(capturedAt)}`, provider: "openai", surface, source: capture?.source || "supported-attachment", account: accountSlot ? { slot: accountSlot, approved } : null, capturedAt: capture?.capturedAt || iso(capturedAt), providerEventAt: providerTrusted ? (capture?.providerEventAt || capture?.capturedAt || null) : null, authority, state: !providerTrusted || !approved || !accountSlot || model.provider !== "openai" ? "observing" : "governing", freshness: "fresh", confidence: providerTrusted ? "measured" : "derived", window: limit ? { id, kind: limit.label || id, resetsAt: limit.resets_at ? iso(limit.resets_at) : null, usedPercentage: first(limit.used_percentage, limit.usedPercentage, null) } : null, model, data: { rate_limits: limits, supplementalVisibleSignal: visible, authorityBasis: providerTrusted ? "trusted-provider-adapter" : (visible ? "visible-supplemental" : "unverified-attachment"), modelSelection: capture?.data?.modelSelection || null, visibleSelectionSignal: capture?.data?.visibleSelectionSignal === true } };
}
export function unavailableObservation(provider, surface, reason, { capturedAt = Date.now() } = {}) {
  return { contract: "usage-max.observation.v1", observationId: `unavailable-${provider}-${surface}-${capturedAt}`, provider, surface, source: "attachment-discovery", account: null, capturedAt: iso(capturedAt), providerEventAt: null, authority: "unattributed", state: "unavailable", freshness: "unknown", confidence: "unknown", window: null, model: { raw: null, canonical: null, known: false, family: null, effort: null }, data: { reason } };
}
