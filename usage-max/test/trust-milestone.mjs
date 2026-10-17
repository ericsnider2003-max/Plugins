#!/usr/bin/env node
// End-to-end safety acceptance matrix for the owner’s trust milestone.
// Every case is local/deterministic; no provider is launched.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canAdmit } from "../scripts/admission.mjs";
import { routePausedTask } from "../scripts/cross-provider.mjs";
import { createTask, transitionTask, acquireLease } from "../scripts/task-state.mjs";
import { recoverTasks } from "../scripts/recovery.mjs";
import { inspectHealth } from "../scripts/watchdog.mjs";
import { captureContinuity, verifyContinuity } from "../scripts/context-continuity.mjs";
import { startSubagent, reconcileSubagents } from "../scripts/subagents.mjs";
import { finalizeTask } from "../scripts/task-finalizer.mjs";
import { executeRepositoryAction } from "../scripts/repository-actions.mjs";
import { saveTask } from "../scripts/task-store.mjs";

const now = Date.parse("2026-10-15T08:00:00Z");
const observed = (usedPercentage) => ({ state: "governing", authority: "provider", freshness: "fresh", capturedAt: new Date(now).toISOString(), account: { slot: "openai-primary", approved: true }, model: { known: true, canonical: "gpt-5.6-luna" }, window: { usedPercentage } });
const base = createTask({ taskId: "trust-milestone-task", idempotencyKey: "trust-milestone-idem", now: new Date(now).toISOString() });
assert.equal(canAdmit({ task: base, observation: observed(95), accountApproved: true, now }).allowed, false, "reserve gate must refuse exhaustion");
assert.equal(canAdmit({ task: base, observation: observed(30), accountApproved: true, now }).allowed, true, "fresh headroom should admit");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-trust-milestone-")); let paused = { ...base, provider: "anthropic", surface: "claude-code", accountSlot: "anthropic-primary" }; paused = transitionTask(paused, "admitted"); paused = transitionTask(paused, "running"); paused = transitionTask(paused, "paused_for_usage");
const handoff = routePausedTask({ home, task: paused, observations: [{ ...observed(20), provider: "openai", surface: "codex-cli", account: { slot: "openai-primary", approved: true } }], now, nextAction: "resume from checkpoint" }); assert.equal(handoff.handedOff, true); assert.equal(handoff.task.state, "handoff_pending"); assert.equal(handoff.pack.credentialsIncluded, false);

const tasksFile = path.join(home, ".usage-max", "tasks.jsonl"); let leased = { ...base, taskId: "restart-task", idempotencyKey: "restart-idem", state: "running", updatedAt: new Date(now).toISOString() }; leased = acquireLease(leased, "worker-1", new Date(now - 1000).toISOString(), new Date(now - 2000).toISOString()); saveTask(tasksFile, leased); assert.equal(recoverTasks(tasksFile, { now: new Date(now).toISOString() })[0].state, "recovery_required");
assert.equal(inspectHealth({ now, lastHeartbeatAt: new Date(now - 400000).toISOString(), lastMeaningfulAt: new Date(now - 400000).toISOString(), failures: 3 }).action, "circuit-open");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-trust-workspace-")); fs.writeFileSync(path.join(workspace, "checkpoint.txt"), "before"); const context = captureContinuity({ workspaceRoot: workspace, files: ["checkpoint.txt"], acceptanceCriteria: ["tests pass"] }); fs.writeFileSync(path.join(workspace, "checkpoint.txt"), "after"); assert.equal(verifyContinuity({ context }, { workspaceRoot: workspace, acceptanceCriteria: ["tests pass"] }).ready, false);

startSubagent(home, { subagentId: "stale-subagent", taskId: base.taskId, now: new Date(now - 3600001).toISOString() }); assert.equal(reconcileSubagents(home, { now, staleMs: 1800000 }).stale.length, 1);
let verifying = transitionTask(base, "admitted"); verifying = transitionTask(verifying, "running"); verifying = transitionTask(verifying, "verifying"); const incomplete = await finalizeTask({ task: verifying, plan: ["tests"], runCheck: async () => ({ passed: false, evidence: "simulated failure" }) }); assert.equal(incomplete.completed, false);
assert.equal(executeRepositoryAction("install", { cwd: workspace, allowMutations: false }).executed, false);
console.log("trust milestone acceptance matrix passed");
