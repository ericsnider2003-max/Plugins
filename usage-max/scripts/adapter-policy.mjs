// Per-adapter sandbox policy. Experimental adapters default off; changing the
// policy never changes provider credentials or enables enforcement.
import fs from "node:fs";
import path from "node:path";

const defaults = {
  "claude-code": { enabled: true, permissions: ["read-provider-observation"], sources: ["claude-hook", "claude-api"], authority: "provider-or-local", retention: "local-ledger" },
  "codex-app-server": { enabled: true, permissions: ["read-provider-observation"], sources: ["codex-app-server", "codex-rollout"], authority: "provider-or-local", retention: "local-ledger" },
  "chatgpt-attachment": { enabled: true, permissions: ["read-redacted-attachment"], sources: ["supported-attachment", "openai-webmcp"], authority: "supplemental", retention: "local-ledger" },
  "chatgpt-browser": { enabled: false, permissions: ["read-visible-labels", "display-notices"], sources: ["browser-visible"], authority: "supplemental", retention: "local-ledger" },
  cowork: { enabled: false, permissions: ["read-redacted-attachment"], sources: ["supported-attachment"], authority: "supplemental", retention: "local-ledger" },
};
const file = (home) => path.join(home, ".usage-max", "adapters.json");
export function defaultAdapterPolicy({ loadError = null } = {}) { return { contract: "usage-max.adapter-policy.v1", version: 1, adapters: Object.fromEntries(Object.entries(defaults).map(([id, value]) => [id, { id, ...value, enabled: loadError ? false : value.enabled, disabledReason: loadError ? "adapter policy is invalid or unreadable" : null }])), ...(loadError ? { loadError } : {}) }; }
export function loadAdapterPolicy(home) {
  const target = file(home);
  if (!fs.existsSync(target)) return defaultAdapterPolicy();
  try {
    const value = JSON.parse(fs.readFileSync(target, "utf8"));
    if (value?.contract === "usage-max.adapter-policy.v1" && value.version === 1 && value.adapters && typeof value.adapters === "object") return value;
    return defaultAdapterPolicy({ loadError: "adapter policy envelope is invalid" });
  } catch { return defaultAdapterPolicy({ loadError: "adapter policy could not be read" }); }
}
function save(home, policy) { fs.mkdirSync(path.dirname(file(home)), { recursive: true }); fs.writeFileSync(file(home), `${JSON.stringify(policy, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); return policy; }
export function adapterId(surface, capture = {}) { if (surface === "chatgpt" && capture.source === "browser-visible") return "chatgpt-browser"; if (["chatgpt", "chatgpt-desktop"].includes(surface)) return "chatgpt-attachment"; if (surface === "cowork") return "cowork"; if (surface.includes("codex")) return "codex-app-server"; if (surface.includes("claude")) return "claude-code"; return surface; }
const defaultSource = (id) => ({ "claude-code": "claude-api", "codex-app-server": "codex-rollout", "chatgpt-attachment": "supported-attachment", "cowork": "supported-attachment" }[id] || null);
export function adapterAllowed(home, surface, capture = {}) {
  const policy = loadAdapterPolicy(home); const id = adapterId(surface, capture); const adapter = policy.adapters[id];
  if (policy.loadError) return { id, allowed: false, policy, reason: policy.loadError };
  if (!adapter) return { id, allowed: false, policy: null, reason: "adapter is not registered" };
  if (adapter.enabled !== true) return { id, allowed: false, policy: adapter, reason: adapter.disabledReason || "adapter is disabled" };
  const source = capture?.source || defaultSource(id);
  if (source && (!Array.isArray(adapter.sources) || !adapter.sources.includes(source))) return { id, allowed: false, policy: adapter, source, reason: `capture source is not allowlisted: ${source}` };
  return { id, allowed: true, policy: adapter, source, reason: null };
}
export function setAdapterEnabled(home, id, enabled, reason = "") { const policy = loadAdapterPolicy(home); const current = policy.adapters[id] || { id, permissions: [], sources: [], authority: "unknown", retention: "local-ledger" }; policy.adapters[id] = { ...current, enabled: Boolean(enabled), disabledReason: enabled ? null : (String(reason) || "disabled by operator") }; return save(home, policy); }
export function emergencyDisableAdapters(home, reason = "emergency adapter stop") { const policy = loadAdapterPolicy(home); for (const adapter of Object.values(policy.adapters)) { adapter.enabled = false; adapter.disabledReason = reason; } return save(home, policy); }
