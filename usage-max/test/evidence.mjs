#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { evidenceReport, formatEvidence } from "../scripts/evidence.mjs";
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-evidence-")), "observations.jsonl");
const base = { contract: "usage-max.observation.v1", observationId: "evidence-001", provider: "openai", surface: "codex-cli", source: "fixture", account: null, capturedAt: "2026-10-15T08:00:00Z", providerEventAt: null, authority: "local-activity", state: "observing", freshness: "unknown", confidence: "derived", window: null, model: null, data: {} };
appendObservation(file, base);
appendObservation(file, { ...base, observationId: "evidence-002", surface: "chatgpt", authority: "unattributed", state: "unavailable" });
const report = evidenceReport(file, { now: Date.parse("2026-10-15T08:05:00Z") });
assert.equal(report.observationCount, 2); assert.equal(report.states.observing, 1); assert.ok(report.coverage.unattributed.includes("chatgpt")); assert.match(formatEvidence(report), /models:/); assert.match(formatEvidence(report), /unattributed surfaces:.*chatgpt/);
console.log("evidence tests passed");
