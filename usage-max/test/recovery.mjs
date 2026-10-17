#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask, acquireLease, reconcileRecovery } from "../scripts/task-state.mjs";
import { recoverTasks } from "../scripts/recovery.mjs";
import { saveTask, taskSnapshot } from "../scripts/task-store.mjs";
const d = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-recovery-")); const file = path.join(d, "tasks.jsonl");
let task = createTask({ taskId: "recover-1", idempotencyKey: "recover-idem", now: "2026-10-15T08:00:00Z" }); task = { ...task, state: "running", updatedAt: "2026-10-15T08:01:00Z" }; task = acquireLease(task, "worker-1", "2026-10-15T08:02:00Z", "2026-10-15T08:01:00Z"); saveTask(file, task);
const recovered = recoverTasks(file, { now: "2026-10-15T08:03:00Z" }); assert.equal(recovered[0].state, "recovery_required"); assert.equal(taskSnapshot(file, "recover-1").recovery.reconciled, false);
const held = reconcileRecovery(recovered[0], { safeToRetry: false, now: "2026-10-15T08:04:00Z" }); assert.equal(held.state, "recovery_required");
const queued = reconcileRecovery(held, { safeToRetry: true, now: "2026-10-15T08:05:00Z" }); assert.equal(queued.state, "queued");
const launched = { ...createTask({ taskId: "launched-1", idempotencyKey: "launched-idem", now: "2026-10-15T08:00:00Z" }), state: "running", provider: "openai", surface: "codex-cli", accountSlot: "openai-primary", launch: { state: "started", idempotencyKey: "handoff:launched-1:checkpoint-1" }, updatedAt: "2026-10-15T08:01:00Z" }; saveTask(file, launched); const afterLaunch = recoverTasks(file, { now: "2026-10-15T08:03:00Z" }); assert.equal(afterLaunch.some((x) => x.taskId === "launched-1"), false); assert.equal(taskSnapshot(file, "launched-1").state, "running"); assert.equal(taskSnapshot(file, "launched-1").surface, "codex-cli");
console.log("restart recovery tests passed");
