// Read-only release/trial readiness projection. It never approves accounts,
// enables adapters, or activates enforcement.
import os from "node:os";
import path from "node:path";
import { activationStatus } from "./activation.mjs";
import { controlReport } from "./control-report.mjs";
import { loadAccounts } from "./accounts.mjs";
import { trialPreflight } from "./trial.mjs";
import { currentTrials } from "./trial.mjs";
import { adapterId, loadAdapterPolicy } from "./adapter-policy.mjs";
import { compatibilityReport } from "./compatibility-doctor.mjs";

export function readinessReport(home = os.homedir(), { now = Date.now(), surface = "codex-cli", taskId = "usage-max-rebuild-0201-trial" } = {}) {
  const control = controlReport(home, { now }); const activation = activationStatus(home); const registry = loadAccounts(path.join(home, ".usage-max", "accounts.json"));
  const approvedAccounts = registry.accounts.filter((x) => x.approved && x.enabled && x.routingEnabled !== false).map((x) => x.slot);
  const trial = trialPreflight(home, { surface, taskId, now }); const trials = currentTrials(home); const compatibility = compatibilityReport(home, { now });
  const blockers = [...trial.missing.map((x) => `trial:${x}`)]; if (activation.mode !== "observation-only") blockers.push("activation:not-observation-only"); if (control.service.mode !== "observation-only") blockers.push("service:unexpected-mode"); if (compatibility.errors > 0) blockers.push("compatibility:errors");
  const policies = loadAdapterPolicy(home).adapters;
  const surfaces = control.surfaces.map((entry) => { const id = adapterId(entry.surface); const policy = policies[id] || null; return { ...entry, adapter: policy ? { id, enabled: policy.enabled === true, permissions: policy.permissions, sources: policy.sources, authority: policy.authority, retention: policy.retention } : { id, enabled: false, reason: "no adapter policy" }, effectiveObservation: policy?.enabled === true ? entry.observation : "disabled", effectiveNotification: policy?.enabled === true ? entry.notification : "disabled" }; });
  return { generatedAt: new Date(now).toISOString(), mode: "observation-only", enforcementEnabled: false, approvedAccounts, trial, trials: { active: trials.filter((x) => x.state === "active").length, total: trials.length }, activation: { startup: activation.startup, hooks: activation.hooks, service: activation.service, processes: activation.processes, nativeHost: activation.nativeHost, mcpHttp: activation.mcpHttp }, attachmentReceiverConfigured: activation.attachmentReceiverConfigured, compatibility, surfaces, blockers, readyForObservationTrial: blockers.length === 0, readyForEnforcement: false };
}

export function formatReadiness(report) { return [`readiness: observation-only`, `observation trial: ${report.readyForObservationTrial ? "ready" : "blocked"}`, `enforcement: disabled`, `compatibility: ${report.compatibility?.status || "unknown"}`, `approved accounts: ${report.approvedAccounts.join(", ") || "none"}`, `active trials: ${report.trials.active}/${report.trials.total}`, `blockers: ${report.blockers.join(", ") || "none"}`].join("\n"); }
