#!/usr/bin/env node
import assert from "node:assert/strict";
import { createTask, transitionTask, recordEffect } from "../scripts/task-state.mjs";
import { verifyCompletion } from "../scripts/completion-verifier.mjs";
import { createHandoffPack } from "../scripts/handoff-pack.mjs";
let task = createTask({ taskId: "task-handoff-001", idempotencyKey: "idem-handoff-001", now: "2026-10-15T08:00:00Z" });
task = transitionTask(task, "admitted"); task = transitionTask(task, "running"); task = transitionTask(task, "checkpointing"); task = recordEffect(task, { effectId: "commit-1", kind: "commit", state: "committed" }); task = transitionTask(task, "verifying");
assert.equal(verifyCompletion({ task, checks: [{ name: "tests", passed: true, evidence: "offline suite passed" }], requiredEffectIds: ["commit-1"] }).complete, true);
assert.equal(verifyCompletion({ task, checks: [{ name: "tests", passed: false }], requiredEffectIds: ["commit-1"] }).complete, false);
const pack = createHandoffPack({ task, observation: { provider: "openai", surface: "codex-cli", authority: "provider", state: "observing", capturedAt: "2026-10-15T08:00:00Z", freshness: "fresh", window: { id: "weekly", usedPercentage: 80 } }, sourceProvider: "openai", sourceSurface: "codex-cli", destinationProvider: "anthropic", destinationSurface: "claude-code", nextAction: "resume from checkpoint", files: ["src/a.js"], decisions: ["preserve API"], failures: ["none"] });
assert.equal(pack.credentialsIncluded, false); assert.equal(pack.destination.provider, "anthropic"); assert.equal(pack.task.taskId, task.taskId); assert.equal(pack.nextAction, "resume from checkpoint");
console.log("completion and handoff tests passed");
