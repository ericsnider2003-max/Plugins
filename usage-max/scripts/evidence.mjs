import fs from "node:fs";
import { readLedger } from "./observation-ledger.mjs";
import { summarizeCoverage } from "./coverage.mjs";
import { reconcileObservations } from "./reconcile.mjs";
export function evidenceReport(ledgerFile, { now = Date.now() } = {}) {
  const observations = readLedger(ledgerFile);
  const states = Object.fromEntries(["governing", "observing", "unavailable", "quarantined"].map((s) => [s, observations.filter((o) => o.state === s).length]));
  const authorities = Object.fromEntries(["provider", "local-activity", "estimate", "unattributed"].map((s) => [s, observations.filter((o) => o.authority === s).length]));
  const reconciliation = reconcileObservations(observations, { now });
  return { generatedAt: new Date(now).toISOString(), observationCount: observations.length, states, authorities, coverage: summarizeCoverage(observations, { now }), reconciliation };
}
export function formatEvidence(report) {
  const c = report.coverage;
  const rec = report.reconciliation.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
  const models = Object.values(c.surfaces).filter((x) => x.observed > 0).map((x) => `${x.surface}=${x.model || "unknown"}/${x.effort || "unknown"}${x.modelSelection ? ` selection=${x.modelSelection}` : ""} authority=${x.authority} freshness=${x.freshness}`).join("; ");
  return [`observations: ${report.observationCount}`, `states: governing=${report.states.governing} observing=${report.states.observing} unavailable=${report.states.unavailable} quarantined=${report.states.quarantined}`, `authority: provider=${report.authorities.provider} local=${report.authorities["local-activity"]} estimate=${report.authorities.estimate} unattributed=${report.authorities.unattributed}`, `models: ${models || "none observed"}`, `reconciliation: ${Object.entries(rec).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`, `governed surfaces: ${c.governed.length ? c.governed.join(", ") : "none"}`, `unattributed surfaces: ${c.unattributed.length ? c.unattributed.join(", ") : "none"}`].join("\n");
}
