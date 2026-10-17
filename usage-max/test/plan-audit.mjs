#!/usr/bin/env node
import assert from "node:assert/strict";
import { implementationPlanAudit, formatPlanAudit } from "../scripts/plan-audit.mjs";
const report = implementationPlanAudit();
assert.equal(report.enforcementEnabled, false);
assert.equal(report.phases.length, 9);
assert.equal(report.phases.find((x) => x.id === "0").status, "verified");
assert.equal(report.phases.find((x) => x.id === "6").status, "gated");
assert.ok(report.blockers.includes("enforcement remains intentionally disabled"));
assert.match(formatPlanAudit(report), /phase 6 gated/);
assert.ok(report.phases.find((x) => x.id === "2").evidence.includes("test/producer-attestation.mjs"));
assert.ok(report.phases.find((x) => x.id === "7").evidence.includes("docs/evidence/worker-launch-boundary-2026-10-15.md"));
console.log("implementation plan audit tests passed");
