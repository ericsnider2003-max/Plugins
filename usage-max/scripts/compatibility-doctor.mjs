import fs from "node:fs";
import os from "node:os";
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger } from "./observation-ledger.mjs";
import { defaultObservationLedger } from "./provider-ingest.mjs";
import { manifest } from "./surface-adapters.mjs";
import { modelRegistry, validateModelRegistry } from "./model-registry.mjs";
import { loadAdapterPolicy } from "./adapter-policy.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredContracts = ["observation.schema.json", "task.schema.json", "model.schema.json", "account.schema.json", "reservation.schema.json"];
const latestBy = (rows, key) => {
  const latest = new Map();
  for (const row of rows) latest.set(row[key], row);
  return [...latest.values()];
};

export function compatibilityReport(home = os.homedir(), { now = Date.now(), freshnessMs = EVIDENCE_FRESHNESS_MS } = {}) {
  const findings = [];
  for (const name of requiredContracts) {
    if (!fs.existsSync(path.join(root, "contracts", name))) findings.push({ severity: "error", kind: "contract-missing", item: name, message: `required contract is missing: ${name}` });
  }
  const registry = modelRegistry(); const registryCheck = validateModelRegistry(registry);
  if (!registryCheck.ok) findings.push({ severity: "error", kind: "model-registry-invalid", item: "data/model-registry.json", message: registryCheck.reason });
  const adapterPolicy = loadAdapterPolicy(home);
  if (adapterPolicy.loadError) findings.push({ severity: "error", kind: "adapter-policy-invalid", item: "adapters.json", message: adapterPolicy.loadError });
  const surfaces = manifest();
  for (const surface of surfaces.filter((x) => x.observation === "unavailable")) findings.push({ severity: "info", kind: "surface-unavailable", item: surface.surface, message: `${surface.surface} has no trusted observation attachment` });
  const ledgerFile = defaultObservationLedger(home);
  const observations = readLedger(ledgerFile);
  const latest = latestBy(observations, "surface");
  for (const row of latest) {
    const age = Date.parse(row.capturedAt || 0);
    if (row.authority === "provider" && (!Number.isFinite(age) || now - age > freshnessMs)) findings.push({ severity: "warning", kind: "adapter-stale", item: row.surface, message: `${row.surface} provider evidence is stale` });
    if (row.model && row.model.known !== true && (row.model.raw || row.model.canonical || row.model.rawId)) findings.push({ severity: "warning", kind: "model-unknown", item: row.model.raw || row.model.rawId || row.surface, message: `model identity is unknown for ${row.surface}; routing must remain conservative` });
  }
  const errors = findings.filter((x) => x.severity === "error").length;
  const warnings = findings.filter((x) => x.severity === "warning").length;
  return { generatedAt: new Date(now).toISOString(), status: errors ? "error" : warnings ? "review" : "pass", errors, warnings, observations: observations.length, modelRegistry: registryCheck, findings };
}

export function formatCompatibilityReport(report) {
  const lines = [`compatibility: ${report.status}`, `observations: ${report.observations}`, `model registry: ${report.modelRegistry?.ok ? `${report.modelRegistry.models} entries` : "invalid"}`, `errors: ${report.errors}; warnings: ${report.warnings}`];
  for (const finding of report.findings) lines.push(`${finding.severity}: ${finding.message}`);
  if (!report.findings.length) lines.push("ok: contracts and observed adapter state have no findings");
  return lines.join("\n");
}
