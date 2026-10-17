#!/usr/bin/env node
// Read-only phase audit for the rebuild plan. It reports evidence and gates;
// it never changes provider settings, approves accounts, starts workers, or
// enables enforcement.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compatibilityReport } from "./compatibility-doctor.mjs";
import { readinessReport } from "./readiness.mjs";
import { validateModelRegistry } from "./model-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.USAGE_MAX_HOME || os.homedir();
const exists = (rel) => fs.existsSync(path.join(root, rel));
const phase = (id, name, status, evidence, blockers = []) => ({ id, name, status, evidence, blockers });

export function implementationPlanAudit({ projectRoot = root, usageHome = home, now = Date.now() } = {}) {
  const has = (rel) => fs.existsSync(path.join(projectRoot, rel));
  const registry = validateModelRegistry();
  const readiness = readinessReport(usageHome, { now });
  const compatibility = compatibilityReport(usageHome, { now });
  const phases = [
    phase("0", "evidence and fixtures", has("test/fixtures/contracts") && has("test/run.mjs") ? "verified" : "incomplete", ["test/fixtures/contracts", "test/run.mjs"]),
    phase("1", "identity and account registry", registry.ok && has("scripts/identity.mjs") && has("scripts/accounts.mjs") ? "verified" : "incomplete", ["data/model-registry.json", "scripts/identity.mjs", "scripts/accounts.mjs"], registry.ok ? [] : [registry.reason]),
    phase("2", "live provider adapters", has("scripts/provider-limits.mjs") && has("scripts/account-activity.mjs") ? "partial" : "incomplete", ["scripts/provider-limits.mjs", "scripts/account-activity.mjs", "test/producer-attestation.mjs", "docs/host-attachment-protocol.md", "docs/research-findings.md"], ["ChatGPT/Cowork provider-authoritative producer is not attached"]),
    phase("3", "observation ledger", has("scripts/observation-ledger.mjs") && has("test/observation-authority.mjs") ? "verified" : "incomplete", ["scripts/observation-ledger.mjs", "test/observation-authority.mjs"]),
    phase("4", "authority and reconciliation", has("scripts/reconcile.mjs") && has("scripts/coverage.mjs") ? "verified" : "incomplete", ["scripts/reconcile.mjs", "scripts/coverage.mjs", "docs/research-findings.md"]),
    phase("5", "reporting and routing", has("scripts/control-report.mjs") && has("scripts/admission.mjs") ? "verified" : "incomplete", ["scripts/control-report.mjs", "scripts/admission.mjs", "scripts/cross-provider.mjs"]),
    phase("6", "guarded enforcement", readiness.readyForEnforcement ? "candidate" : "gated", ["scripts/rollout.mjs", "test/rollout.mjs", "docs/evidence/real-host-readiness-2026-10-15.md"], ["enforcement remains intentionally disabled", ...readiness.blockers]),
    phase("7", "autonomous operations control plane", has("scripts/worker-service.mjs") && has("scripts/worker-loop.mjs") && has("scripts/recovery.mjs") ? "partial" : "incomplete", ["scripts/worker-service.mjs", "scripts/worker-loop.mjs", "scripts/recovery.mjs", "scripts/worker-adapters.mjs", "scripts/handoff-pack.mjs", "docs/evidence/worker-launch-boundary-2026-10-15.md", "docs/research-autonomous-operations.md"], ["live worker launch remains attachment- and rollout-gated"]),
    phase("8", "ongoing maintenance", compatibility.status !== "error" && has("scripts/compatibility-doctor.mjs") ? "verified" : "incomplete", ["scripts/compatibility-doctor.mjs", "data/model-registry.json"], compatibility.status === "error" ? ["compatibility doctor reports errors"] : []),
  ];
  return { generatedAt: new Date(now).toISOString(), projectRoot, mode: readiness.mode, enforcementEnabled: false, readiness: { readyForObservationTrial: readiness.readyForObservationTrial, readyForEnforcement: readiness.readyForEnforcement, blockers: readiness.blockers }, compatibility: { status: compatibility.status, errors: compatibility.errors, warnings: compatibility.warnings }, phases, blockers: [...new Set(phases.flatMap((x) => x.blockers))] };
}

export function formatPlanAudit(report) {
  const lines = [`implementation plan: ${report.mode}`, `enforcement: ${report.enforcementEnabled ? "enabled" : "disabled"}`];
  for (const p of report.phases) lines.push(`phase ${p.id} ${p.status}: ${p.name}${p.blockers.length ? ` — ${p.blockers.join("; ")}` : ""}`);
  if (report.blockers.length) lines.push(`blockers: ${report.blockers.join("; ")}`);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = implementationPlanAudit(); console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatPlanAudit(report)); process.exitCode = report.blockers.length ? 1 : 0;
}
