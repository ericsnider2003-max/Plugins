import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evidenceReport } from "./evidence.mjs";
import { manifest } from "./surface-adapters.mjs";
import { serviceState } from "./worker-service.mjs";
import { currentTrials, evaluateTrial } from "./trial.mjs";
import { loadTasks } from "./task-store.mjs";
import { readAccountActivity, summarizeAccountActivity } from "./account-activity.mjs";
import { readCollectorEvents, collectorFreshness } from "./collector-queue.mjs";
import { readAttachmentEnvelopes } from "./attachments.mjs";
import { loadAccounts } from "./accounts.mjs";

export function controlReport(home = os.homedir(), { now = Date.now() } = {}) {
  const data = path.join(home, ".usage-max"); const tasks = [...loadTasks(path.join(data, "tasks.jsonl")).values()];
  const observations = path.join(data, "observations.jsonl");
  const activity = readAccountActivity(path.join(data, "account-activity.jsonl"));
  const collectorEvents = readCollectorEvents(path.join(data, "collector-events.jsonl"));
  const collectorSummary = collectorEvents.reduce((out, event) => { const freshness = collectorFreshness(event, { now }); out.events += 1; out.devices.add(event.deviceFingerprint); out[freshness.freshness] += 1; return out; }, { events: 0, devices: new Set(), fresh: 0, stale: 0, unknown: 0 });
  collectorSummary.devices = collectorSummary.devices.size;
  const activitySummary = activity.reduce((out, snapshot) => { const row = summarizeAccountActivity(snapshot); out.snapshots += 1; out.activityRows += row.activityRows; out.providerTokens += row.providerTokens; out.providerRequests += row.providerRequests; out.unattributedRows += row.unattributedRows; return out; }, { snapshots: 0, activityRows: 0, providerTokens: 0, providerRequests: 0, unattributedRows: 0 });
  const trials = currentTrials(home); const attachments = Object.fromEntries(readAttachmentEnvelopes(home).map((x) => [x.surface, { attached: true }])); const accounts = loadAccounts(path.join(data, "accounts.json")).accounts; const approvals = Object.fromEntries(accounts.flatMap((x) => x.surfaces.map((surface) => [surface, Boolean(x.approved && x.enabled)])));
  return { generatedAt: new Date(now).toISOString(), evidence: evidenceReport(observations, { now }), accountActivity: activitySummary, collector: collectorSummary, tasks: { total: tasks.length, byState: Object.fromEntries([...new Set(tasks.map((x) => x.state))].map((s) => [s, tasks.filter((x) => x.state === s).length])), recoveryRequired: tasks.filter((x) => x.state === "recovery_required").map((x) => x.taskId) }, trials: { active: trials.filter((x) => x.state === "active").length, total: trials.length, rows: trials.map((x) => ({ trialId: x.trialId, surface: x.surface, taskId: x.taskId, state: x.state, mode: x.mode, startedAt: x.startedAt, metricCount: Array.isArray(x.metrics) ? x.metrics.length : 0, gate: evaluateTrial(x) })) }, surfaces: manifest({ attachments, approvals }), service: serviceState(home) };
}
export function formatControlReport(report) {
  const e = report.evidence; const c = e.coverage; const models = Object.values(c.surfaces).filter((x) => x.observed > 0).map((x) => `${x.surface}=${x.model || "unknown"}/${x.effort || "unknown"}${x.modelSelection ? ` selection=${x.modelSelection}` : ""} authority=${x.authority} freshness=${x.freshness}`).join("; ");
  const trialText = report.trials.rows.map((x) => `${x.surface}/${x.taskId}=${x.state}, metrics=${x.metricCount}, gate=${x.gate.ready ? "ready" : x.gate.missing.join("+") || "review"}`).join("; ");
  return [`generated: ${report.generatedAt}`, `observations: ${e.observationCount} (governing=${e.states.governing}, observing=${e.states.observing}, unavailable=${e.states.unavailable}, quarantined=${e.states.quarantined})`, `models/authority: provider=${e.authorities.provider}, local=${e.authorities["local-activity"]}, unknown=${e.authorities.unattributed}`, `current models: ${models || "none observed"}`, `account activity: snapshots=${report.accountActivity.snapshots} rows=${report.accountActivity.activityRows} provider_tokens=${report.accountActivity.providerTokens} unattributed_rows=${report.accountActivity.unattributedRows}`, `collectors: events=${report.collector.events} devices=${report.collector.devices} fresh=${report.collector.fresh} stale=${report.collector.stale} unknown=${report.collector.unknown}`, `coverage: governed=${c.governed.join(", ") || "none"}; unavailable=${c.unattributed.join(", ") || "none"}`, `tasks: ${report.tasks.total}; recovery_required=${report.tasks.recoveryRequired.length}`, `trials: ${report.trials.active} active / ${report.trials.total} total${trialText ? ` (${trialText})` : ""}`, `service: ${report.service.running ? "running" : "stopped"} (${report.service.mode})`].join("\n");
}
