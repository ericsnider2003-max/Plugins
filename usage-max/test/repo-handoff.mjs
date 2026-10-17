#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyRepository } from "../scripts/repo-verifier.mjs";
import { requestHandoff } from "../scripts/handoff.mjs";
import { verifyContinuity } from "../scripts/context-continuity.mjs";
const checks = await verifyRepository({ plan: ["tests", "lint", "git-clean", "install"], runCheck: async (name) => ({ passed: true, evidence: `${name}: fixture passed` }) });
assert.equal(checks.passed, true); assert.equal((await verifyRepository({ plan: ["arbitrary-shell"], runCheck: async () => ({ passed: true }) })).passed, false);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-handoff-")); const task = { contract: "usage-max.task.v1", taskId: "handoff-task", state: "running", provider: "anthropic", surface: "claude-code", idempotencyKey: "handoff-idem", checkpoint: { version: 1, path: "checkpoint", digest: "x" }, effects: [] };
const result = requestHandoff({ home, task, destinationProvider: "openai", destinationSurface: "codex-cli", nextAction: "resume from checkpoint", now: "2026-10-15T08:00:00Z" });
assert.equal(result.task.state, "handoff_pending"); assert.equal(result.pack.credentialsIncluded, false); assert.ok(fs.existsSync(path.join(home, ".usage-max", "tasks.jsonl")));
const duplicate = requestHandoff({ home, task, destinationProvider: "openai", destinationSurface: "codex-cli", nextAction: "resume from checkpoint", now: "2026-10-15T08:01:00Z" }); assert.equal(duplicate.duplicate, true);
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-context-")); fs.writeFileSync(path.join(workspace, "checkpoint.txt"), "checkpoint-v1"); const contextTask = { ...task, taskId: "handoff-context", idempotencyKey: "handoff-context-idem", checkpoint: { version: 2, path: "checkpoint.txt", digest: "digest-context" } };
const contextual = requestHandoff({ home, task: contextTask, destinationProvider: "openai", destinationSurface: "codex-cli", nextAction: "resume after verifying context", workspaceRoot: workspace, files: ["checkpoint.txt"], acceptanceCriteria: ["tests pass", "working tree clean"], now: "2026-10-15T08:02:00Z" });
assert.equal(verifyContinuity(contextual.pack, { workspaceRoot: workspace, checkpoint: contextTask.checkpoint, effects: contextTask.effects, acceptanceCriteria: ["tests pass", "working tree clean"] }).ready, true);
fs.writeFileSync(path.join(workspace, "checkpoint.txt"), "changed"); assert.equal(verifyContinuity(contextual.pack, { workspaceRoot: workspace, checkpoint: contextTask.checkpoint, effects: contextTask.effects, acceptanceCriteria: ["tests pass", "working tree clean"] }).ready, false);
console.log("repository verification and handoff queue tests passed");
