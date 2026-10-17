// Evidence-first provider/surface dossier. Read-only: it never approves,
// launches, switches accounts, or enables enforcement.
import os from "node:os";
import path from "node:path";
import { activationStatus } from "./activation.mjs";
import { adapterId, loadAdapterPolicy } from "./adapter-policy.mjs";
import { defaultObservationLedger } from "./provider-ingest.mjs";
import { readLedger } from "./observation-ledger.mjs";
import { readinessReport } from "./readiness.mjs";
import { surfaceDefinitions } from "./surface-adapters.mjs";
import { loadAccounts } from "./accounts.mjs";

const byNewest = (a, b) => Date.parse(b?.capturedAt || 0) - Date.parse(a?.capturedAt || 0);
const safeObservation = (x) => x ? { observationId: x.observationId || null, source: x.source || null, capturedAt: x.capturedAt || null, providerEventAt: x.providerEventAt || null, authority: x.authority || "unknown", state: x.state || "unknown", freshness: x.freshness || "unknown", model: x.model ? { canonical: x.model.canonical || null, raw: x.model.raw || null, known: x.model.known === true, effort: x.model.effort || null } : null, modelSelection: x.data?.modelSelection || null, window: x.window ? { id: x.window.id || null, usedPercentage: x.window.usedPercentage ?? null, resetsAt: x.window.resetsAt || null } : null } : null;

function remedy(surface, { latest, approved, mcpHttp } = {}) {
  if (surface === "browser" || surface === "mobile") return "no supported allowance adapter; keep this surface unavailable rather than infer capacity";
  if (surface === "chatgpt" || surface === "chatgpt-desktop") {
    if (!mcpHttp?.available) return "restore the read-only HTTP MCP bridge, then connect it through Secure MCP Tunnel or a protected HTTPS relay";
    if (!latest || latest.authority !== "provider") return "connect a trusted structured provider producer; visible DOM/WebMCP signals remain supplemental";
  }
  if (surface === "cowork" && (!latest || latest.authority !== "provider")) return "attach a trusted structured Cowork producer; process presence and MCP visibility do not prove allowance";
  if (!latest) return "capture a fresh provider-authoritative observation for this surface";
  if (!approved) return "review and explicitly approve the bound account slot before routing or trial admission";
  if (latest.freshness !== "fresh") return "refresh provider evidence; stale observations cannot govern";
  if (latest.model?.known !== true) return "add or verify the observed model in the versioned registry";
  return "no additional safe action detected";
}

export function capabilityDossier(home = os.homedir(), { now = Date.now() } = {}) {
  const readiness = readinessReport(home, { now }); const activation = activationStatus(home); const registry = loadAccounts(path.join(home, ".usage-max", "accounts.json")); const policy = loadAdapterPolicy(home).adapters; const ledger = readLedger(defaultObservationLedger(home));
  const accountsBySurface = new Map(); for (const account of registry.accounts) for (const surface of account.surfaces || []) accountsBySurface.set(surface, account);
  const surfaces = surfaceDefinitions().flatMap((definition) => definition.surfaces.map((surface) => {
    const rows = ledger.filter((x) => x.surface === surface).sort(byNewest); const latest = rows[0] || null; const account = latest?.account?.slot ? registry.accounts.find((x) => x.slot === latest.account.slot) : accountsBySurface.get(surface); const adapter = policy[adapterId(surface, latest || {})] || null;
    return { surface, provider: definition.provider, adapter: adapter ? { id: adapter.id, enabled: adapter.enabled === true, authority: adapter.authority || "unknown", sources: adapter.sources || [] } : null, capability: readiness.surfaces.find((x) => x.surface === surface) || null, approvedAccount: Boolean(account?.approved && account.enabled !== false), latest: safeObservation(latest), evidenceCount: rows.length, remedy: remedy(surface, { latest, approved: Boolean(account?.approved && account.enabled !== false), mcpHttp: activation.mcpHttp }) };
  }));
  const nextActions = [...new Set([...readiness.blockers.map((x) => x.startsWith("trial:approved-account") ? "approve the exact observed account slot after review" : x.startsWith("trial:approved-provider-authority") ? "capture fresh provider-authoritative evidence" : x), ...surfaces.map((x) => x.remedy).filter((x) => x && x !== "no additional safe action detected")])];
  return { generatedAt: new Date(now).toISOString(), mode: "observation-only", enforcementEnabled: false, mcpHttp: activation.mcpHttp, surfaces, nextActions, blockers: readiness.blockers };
}

export function formatCapabilityDossier(report) {
  const lines = [`dossier: observation-only`, `enforcement: disabled`, `HTTP MCP: ${report.mcpHttp?.available ? "available" : "missing"}`, `blockers: ${report.blockers.join(", ") || "none"}`];
  for (const row of report.surfaces) lines.push(`${row.surface}: evidence=${row.evidenceCount} authority=${row.latest?.authority || "none"} freshness=${row.latest?.freshness || "none"} model=${row.latest?.model?.canonical || row.latest?.model?.raw || "unknown"} remedy=${row.remedy}`);
  lines.push(`next: ${report.nextActions.join("; ") || "no action required"}`); return lines.join("\n");
}
