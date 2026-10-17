#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { saveTask } from "../scripts/task-store.mjs";
import { tick } from "../scripts/worker-service.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-health-notices-")); const data = path.join(home, ".usage-max"); fs.mkdirSync(data, { recursive: true });
appendObservation(path.join(data, "observations.jsonl"), { observationId: "health-notice-observation", provider: "openai", surface: "codex-cli", capturedAt: "2026-10-15T08:00:00Z", authority: "provider", state: "governing", freshness: "fresh", account: { slot: "openai-primary", approved: true }, model: { known: true, canonical: "gpt-5.6-luna" }, window: { usedPercentage: 20 } });
saveTask(path.join(data, "tasks.jsonl"), { taskId: "verify-notice-001", state: "verifying", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary", updatedAt: "2026-10-15T08:00:00Z", createdAt: "2026-10-15T07:00:00Z", attempt: 1, verification: { complete: false, checks: [], missingEffects: [], reason: "required check failed or is missing" } });
saveTask(path.join(data, "tasks.jsonl"), { taskId: "retry-notice-001", state: "failed", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary", updatedAt: "2026-10-15T08:00:00Z", createdAt: "2026-10-15T07:00:00Z", attempt: 1, retryAt: "2026-10-15T08:10:00Z", retry: { maxAttempts: 2 } });
saveTask(path.join(data, "tasks.jsonl"), { taskId: "dead-letter-001", state: "failed", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary", updatedAt: "2026-10-15T08:00:00Z", createdAt: "2026-10-15T07:00:00Z", attempt: 2, retry: { maxAttempts: 2 } });
saveTask(path.join(data, "tasks.jsonl"), { taskId: "launch-review-001", state: "handoff_pending", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary", updatedAt: "2026-10-15T08:00:00Z", createdAt: "2026-10-15T07:00:00Z", launch: { state: "failed", idempotencyKey: "handoff:launch-review-001:checkpoint-1", provider: "openai", surface: "codex-cli" } });
await tick({ home, now: Date.parse("2026-10-15T08:01:00Z"), capture: false, autoHandoff: false });
const outbox = fs.readFileSync(path.join(data, "notifications.jsonl"), "utf8"); assert.match(outbox, /verification-failed/); assert.match(outbox, /task-retry-scheduled/); assert.match(outbox, /dead-letter-review/); assert.match(outbox, /task-launch-review/); console.log("task health notice tests passed");
