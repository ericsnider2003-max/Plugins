#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { trialPreflight } from "../scripts/trial.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-trial-preflight-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true }); const now = Date.parse("2026-10-15T08:00:00Z");
assert.equal(trialPreflight(home, { surface: "codex-cli", taskId: "trial-task-001", now }).ready, false);
appendObservation(path.join(home, ".usage-max", "observations.jsonl"), { observationId: "trial-preflight-001", provider: "openai", surface: "codex-cli", capturedAt: "2026-10-15T07:59:00Z", authority: "provider", state: "governing", freshness: "fresh", account: { slot: "openai-primary", approved: true }, model: { raw: "o4-mini", canonical: "o4-mini", known: true }, window: { id: "weekly", usedPercentage: 20 }, data: {} });
assert.equal(trialPreflight(home, { surface: "codex-cli", taskId: "trial-task-001", now }).ready, true); assert.equal(trialPreflight(home, { surface: "codex-cli", taskId: "trial-task-001", now }).observation.model.canonical, "o4-mini");
appendObservation(path.join(home, ".usage-max", "observations.jsonl"), { observationId: "trial-preflight-unapproved-newer", provider: "openai", surface: "codex-cli", capturedAt: "2026-10-15T07:59:30Z", authority: "unattributed", state: "observing", freshness: "fresh", account: { slot: "unapproved", approved: false }, model: { raw: "gpt-5.4", canonical: "gpt-5.4", known: true }, window: { id: "weekly", usedPercentage: 25 }, data: {} });
assert.equal(trialPreflight(home, { surface: "codex-cli", taskId: "trial-task-001", now }).ready, true); assert.equal(trialPreflight(home, { surface: "codex-cli", taskId: "trial-task-001", now }).observation.account.slot, "openai-primary");
console.log("trial preflight tests passed");
