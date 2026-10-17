// Provider-neutral identity helpers. Pure, offline, and backed by the versioned model registry.
import { lookupModel } from "./model-registry.mjs";
const MODEL_FIELDS = ["model", "model_id", "modelId", "model_slug", "modelSlug", "model_name", "modelName", "model_display_name", "modelDisplayName", "conversation_model", "conversationModel", "default_model_slug", "defaultModelSlug", "selected_model", "selectedModel"];
const EFFORT_FIELDS = ["effort", "reasoning_effort", "reasoningEffort", "effort_level", "effortLevel", "model_reasoning_effort", "modelReasoningEffort"];
const ACTORS = new Map([["codex-auto-review", "auto-review"], ["auto-review", "auto-review"], ["router", "router"], ["auto", "router"]]);

const text = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const providerFor = (raw, surface = "unknown") => {
  const s = String(surface).toLowerCase();
  const surfaceProvider = s.includes("claude") || s.includes("cowork") ? "anthropic" : s.includes("chatgpt") || s.includes("codex") ? "openai" : null;
  const rawProvider = /^claude[-_]/i.test(raw || "") ? "anthropic" : /^(gpt|codex)[-_]/i.test(raw || "") || /^o[1-9]/i.test(raw || "") ? "openai" : null;
  if (surfaceProvider && rawProvider && surfaceProvider !== rawProvider) return "unknown";
  return surfaceProvider || rawProvider || "unknown";
};

function findModel(value, path0 = "payload", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (/\.model$/i.test(path0) && typeof value.id === "string" && value.id.trim()) return { rawId: value.id.trim(), sourceField: `${path0}.id` };
  if (/\.model$/i.test(path0) && typeof value.display_name === "string" && value.display_name.trim()) return { rawId: value.display_name.trim(), sourceField: `${path0}.display_name` };
  for (const key of MODEL_FIELDS) {
    const v = value[key];
    if (typeof v === "string" && v.trim()) return { rawId: v.trim(), sourceField: `${path0}.${key}` };
    if (v && typeof v === "object") {
      const nested = findModel(v, `${path0}.${key}`, seen);
      if (nested) return nested;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      const nested = findModel(child, `${path0}.${key}`, seen);
      if (nested) return nested;
    }
  }
  return null;
}

function findEffort(value, path0 = "payload", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const key of EFFORT_FIELDS) { const v = value[key]; if (typeof v === "string" && v.trim()) return { value: v.trim(), sourceField: `${path0}.${key}` }; }
  for (const [key, child] of Object.entries(value)) { if (child && typeof child === "object") { const nested = findEffort(child, `${path0}.${key}`, seen); if (nested) return nested; } }
  return null;
}

function canonical(raw) {
  const r = text(raw);
  if (!r) return null;
  const lower = r.toLowerCase().replaceAll("_", "-");
  if (ACTORS.has(lower)) return { canonicalId: null, family: null, generation: null, variant: null, actor: ACTORS.get(lower), known: false };
  const registered = lookupModel(lower);
  if (registered) return { canonicalId: registered.id, family: registered.family, generation: registered.generation, variant: registered.variant, actor: "model", known: true };
  return { canonicalId: null, family: null, generation: null, variant: null, actor: "unknown", known: false };
}

export function identifyModel(input, { surface = "unknown", observedAt = null } = {}) {
  const found = findModel(input);
  const effort = findEffort(input);
  const rawId = found?.rawId || null;
  const c = canonical(rawId) || { canonicalId: null, family: null, generation: null, variant: null, actor: "unknown", known: false };
  return { provider: providerFor(rawId, surface), surface, rawId, canonicalId: c.canonicalId, known: c.known, actor: c.actor, family: c.family, generation: c.generation, variant: c.variant, effort: effort?.value || null, sourceField: found?.sourceField || null, effortSourceField: effort?.sourceField || null, observedAt, confidence: rawId && c.known ? "normalized" : rawId ? "unknown" : "unknown" };
}

export function accountAllowed(slot, registry) {
  const a = registry?.accounts?.find((x) => x.slot === slot);
  return Boolean(a?.approved && a.enabled);
}

export function validateAccountRegistry(registry) {
  if (!registry || registry.contract !== "usage-max.account-registry.v1" || !Array.isArray(registry.accounts)) return { ok: false, reason: "invalid registry envelope" };
  const seen = new Set();
  for (const a of registry.accounts) {
    if (!a.slot || seen.has(a.slot)) return { ok: false, reason: "missing or duplicate account slot" };
    if (!a.homeFingerprint || typeof a.approved !== "boolean" || typeof a.enabled !== "boolean") return { ok: false, reason: `invalid account slot ${a.slot}` };
    seen.add(a.slot);
  }
  return { ok: true };
}
