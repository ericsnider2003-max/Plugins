#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask } from "../scripts/task-state.mjs";
import { saveTask } from "../scripts/task-store.mjs";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { taskConsole } from "../scripts/task-console.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-task-console-")); const data = path.join(home, ".usage-max"); fs.mkdirSync(data, { recursive: true });
saveTask(path.join(data, "tasks.jsonl"), { ...createTask({ taskId: "console-task-001", idempotencyKey: "console-idem-001", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary" }), state: "paused_for_usage" });
const ledger = path.join(data, "observations.jsonl");
appendObservation(ledger, { observationId: "console-provider-001", provider: "openai", surface: "codex-cli", account: { slot: "openai-primary", approved: true }, capturedAt: "2026-10-15T08:00:00Z", authority: "provider", state: "governing", freshness: "fresh", model: { canonical: "gpt-5.6-luna", known: true }, window: { id: "weekly", usedPercentage: 80, resetsAt: "2026-10-15T10:00:00Z" }, data: {} });
appendObservation(ledger, { observationId: "console-local-002", provider: "openai", surface: "codex-cli", account: { slot: "openai-primary", approved: true }, capturedAt: "2026-10-15T08:00:01Z", authority: "local-activity", state: "observing", freshness: "fresh", model: { canonical: "gpt-5.6-luna", known: true }, window: { id: "weekly", usedPercentage: 20, resetsAt: "2026-10-15T10:00:00Z" }, data: { modelSelection: "thinking" } });
const row = taskConsole(home, { now: Date.parse("2026-10-15T08:01:00Z") }).tasks[0]; assert.equal(row.quota.usedPercentage, 80); assert.equal(row.authority, "provider"); assert.equal(row.wake.state, "waiting-for-reset"); assert.equal(row.modelSelection, "thinking");
console.log("task console authority tests passed");
