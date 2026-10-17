import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatReadiness, readinessReport } from "../scripts/readiness.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-readiness-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true });
const report = readinessReport(home, { now: Date.parse("2026-10-15T08:00:00Z") }); assert.equal(report.mode, "observation-only"); assert.equal(report.enforcementEnabled, false); assert.equal(report.readyForEnforcement, false); assert.equal(report.readyForObservationTrial, false); assert.equal(report.attachmentReceiverConfigured, false); assert.ok(report.activation.processes && typeof report.activation.processes.available === "boolean"); assert.ok(report.surfaces.some((x) => x.surface === "chatgpt" && x.taskLaunch === "unavailable" && x.adapter.enabled === true && x.effectiveObservation === "unavailable")); assert.ok(report.surfaces.some((x) => x.surface === "cowork" && x.adapter.enabled === false && x.effectiveObservation === "disabled")); assert.match(formatReadiness(report), /enforcement: disabled/); assert.ok(report.blockers.includes("trial:observation"));
assert.equal(report.compatibility.modelRegistry.ok, true); assert.match(formatReadiness(report), /compatibility: /);
console.log("readiness tests passed");
