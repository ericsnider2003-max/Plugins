import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { readLedger } from "./observation-ledger.mjs";
import { defaultObservationLedger } from "./provider-ingest.mjs";
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";

function file(home) { return path.join(home, ".usage-max", "trials.jsonl"); }
function id(input) { return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20); }
function append(home, value) { const f = file(home); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); }
export function readTrials(home) { const f = file(home); if (!fs.existsSync(f)) return []; return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x)); }
export function currentTrials(home) {
  const latest = new Map();
  for (const trial of readTrials(home)) latest.set(trial.trialId, trial);
  return [...latest.values()];
}
export function startTrial(home, { surface, taskId, now = new Date().toISOString(), baseline = {} } = {}) {
  if (!surface || !taskId) throw new Error("surface and taskId are required");
  const trial = { contract: "usage-max.trial.v1", trialId: id({ surface, taskId, now }), surface, taskId, mode: "observation-only", state: "active", startedAt: now, baseline, metrics: [] };
  append(home, trial); return trial;
}
export function trialPreflight(home = os.homedir(), { surface, taskId, now = Date.now(), maxAgeMs = EVIDENCE_FRESHNESS_MS } = {}) {
  const missing = []; if (!surface) missing.push("surface"); if (!taskId) missing.push("taskId"); if (missing.length) return { ready: false, reason: "trial identity is incomplete", missing };
  const rows = readLedger(defaultObservationLedger(home)).filter((x) => x.surface === surface).sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0)); const candidate = rows.find((x) => x.authority === "provider" && x.state === "governing" && x.freshness === "fresh" && x.model?.known === true && x.account?.slot && x.account.approved === true); const latest = candidate || rows[0];
  if (!latest) missing.push("observation"); else {
    const age = now - Date.parse(latest.capturedAt || 0); if (latest.authority !== "provider" || latest.state !== "governing") missing.push("approved-provider-authority"); if (!Number.isFinite(age) || age < 0 || age > maxAgeMs || latest.freshness !== "fresh") missing.push("fresh-observation"); if (latest.model?.known !== true) missing.push("known-model"); if (!latest.account?.slot || latest.account.approved !== true) missing.push("approved-account");
  }
  return { ready: missing.length === 0, reason: missing.length ? "trial preflight evidence is incomplete" : "trial may start in observation-only mode", missing, surface, taskId, observation: latest ? { capturedAt: latest.capturedAt, model: latest.model, account: latest.account, window: latest.window } : null };
}
export function recordTrialMetric(home, trialId, metric, now = new Date().toISOString()) {
  const trials = readTrials(home); const current = trials.findLast((x) => x.trialId === trialId && x.state === "active");
  if (!current) throw new Error("active trial not found");
  const next = { ...current, metrics: [...current.metrics, { ...metric, recordedAt: now }] }; append(home, next); return next;
}
export function endTrial(home, trialId, { outcome = "review", now = new Date().toISOString() } = {}) {
  const current = readTrials(home).findLast((x) => x.trialId === trialId && x.state === "active");
  if (!current) throw new Error("active trial not found");
  const next = { ...current, state: "ended", endedAt: now, outcome }; append(home, next); return next;
}
export function evaluateTrial(trial, { minDurationMs = 24 * 60 * 60 * 1000, minMetrics = 5 } = {}) {
  const durationMs = Date.parse(trial?.endedAt || 0) - Date.parse(trial?.startedAt || 0); const metrics = Array.isArray(trial?.metrics) ? trial.metrics : [];
  const names = new Set(metrics.flatMap((m) => m && m.name ? [m.name] : [])); const required = ["modelIdentity", "providerFreshness", "taskProgress", "completionEvidence", "recoveryEvidence"];
  const missing = required.filter((name) => !metrics.some((m) => m?.[name] === true || (m?.name === name && m?.passed === true)));
  if (trial?.state !== "ended") return { ready: false, reason: "trial is not ended", missing: ["trial-ended"], durationMs, metricCount: metrics.length };
  if (durationMs < minDurationMs) missing.push("trial-duration");
  if (metrics.length < minMetrics) missing.push("trial-depth");
  return { ready: missing.length === 0, reason: missing.length ? "trial evidence incomplete" : "trial evidence meets minimum gate", missing, durationMs, metricCount: metrics.length, observedNames: [...names] };
}
