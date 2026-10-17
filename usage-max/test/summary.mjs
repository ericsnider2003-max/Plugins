#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { formatSummary, summaryReport } from "../scripts/summary.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-summary-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true });
appendObservation(path.join(home, ".usage-max", "observations.jsonl"), { observationId: "summary-001", provider: "openai", surface: "codex-cli", capturedAt: "2026-10-15T07:55:00Z", authority: "provider", state: "governing", freshness: "fresh", model: { canonical: "o4-mini", raw: "o4-mini", known: true, effort: "high" }, data: {} });
appendObservation(path.join(home, ".usage-max", "observations.jsonl"), { observationId: "summary-002", provider: "openai", surface: "chatgpt", capturedAt: "2026-10-15T07:56:00Z", authority: "unattributed", state: "observing", freshness: "unknown", model: { canonical: null, raw: "future-model", known: false }, data: {} });
const report = summaryReport(home, { now: Date.parse("2026-10-15T08:00:00Z"), days: 1 }); assert.equal(report.observations.total, 2); assert.equal(report.observations.models["o4-mini"], 1); assert.equal(report.observations.efforts.high, 1); assert.equal(report.observations.unknownEffort, 1); assert.ok(report.next.includes("review unknown model identities")); assert.match(formatSummary(report), /chatgpt=1/); assert.match(formatSummary(report), /effort:/);
console.log("summary report tests passed");
