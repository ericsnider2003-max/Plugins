#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderDashboard, writeDashboard } from "../scripts/dashboard.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-dashboard-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true }); const report = { generatedAt: "2026-10-15T08:00:00Z", evidence: { observationCount: 1, coverage: { governed: [], unattributed: ["chatgpt"] } }, observations: [{ provider: "openai", surface: "chatgpt", account: { slot: "openai-primary" }, model: { canonical: null }, data: { modelSelection: "thinking" }, window: { kind: "WEEKLY", usedPercentage: 4 }, source: "browser-visible", capturedAt: "2026-10-15T08:00:00Z", authority: "unattributed", freshness: "fresh" }], taskRows: [{ taskId: "t-001", state: "paused_for_usage", provider: "openai", surface: "chatgpt", model: null, modelSelection: "thinking", quota: { usedPercentage: 4 }, wake: { state: "needs-observation" }, checkpoint: { digest: "digest-1" }, lease: null }], surfaces: [{ surface: "chatgpt", provider: "openai", observation: "unavailable", notification: "unavailable", reason: "no attachment" }], tasks: { total: 1, recoveryRequired: [] }, trials: { active: 0, total: 0 } };
assert.match(renderDashboard(report), /thinking/); assert.match(renderDashboard(report), /Visible selection/); assert.match(renderDashboard(report), /Observation detail/); const file = writeDashboard(home); assert.ok(fs.existsSync(file)); assert.match(fs.readFileSync(file, "utf8"), /Enforcement is not activated/);
console.log("dashboard tests passed");
