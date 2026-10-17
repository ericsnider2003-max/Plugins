import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "model-registry.json");
function load() {
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); if (value?.contract === "usage-max.model-registry.v1" && value.version === 1 && Array.isArray(value.models)) return value; return { contract: "usage-max.model-registry.v1", version: 1, models: [], loadError: "model registry envelope is invalid" }; } catch { return { contract: "usage-max.model-registry.v1", version: 1, models: [], loadError: "model registry could not be read" }; }
}
const normalize = (value) => String(value || "").trim().toLowerCase().replaceAll("_", "-");
export function modelRegistry() { return load(); }
export function lookupModel(raw) {
  const key = normalize(raw); if (!key) return null;
  const row = load().models.find((x) => normalize(x.id) === key || (x.aliases || []).some((alias) => normalize(alias) === key));
  return row ? { ...row, aliases: [...(row.aliases || [])] } : null;
}
export function validateModelRegistry(registry = load()) {
  if (registry?.loadError) return { ok: false, reason: registry.loadError };
  if (!registry || registry.contract !== "usage-max.model-registry.v1" || registry.version !== 1 || !Array.isArray(registry.models)) return { ok: false, reason: "invalid model registry envelope" };
  const seen = new Set();
  for (const model of registry.models) {
    const id = normalize(model?.id); if (!id || seen.has(id) || !["openai", "anthropic"].includes(model.provider)) return { ok: false, reason: `invalid or duplicate model entry: ${model?.id || "missing"}` };
    seen.add(id); for (const alias of model.aliases || []) { const key = normalize(alias); if (!key || seen.has(key)) return { ok: false, reason: `invalid or duplicate model alias: ${alias || "missing"}` }; seen.add(key); }
  }
  return { ok: true, version: registry.version, models: registry.models.length };
}
