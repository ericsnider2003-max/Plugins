#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildClaudePrompt, parseClaudeOutput } from "../scripts/claude-headless-adapter.mjs";
import { createTask } from "../scripts/task-state.mjs";
const task = createTask({ taskId: "claude-adapter-001", idempotencyKey: "claude-adapter-idem", now: "2026-10-17T08:00:00Z", executionMode: "unattended" });
assert.match(buildClaudePrompt(task), /USAGE_MAX_RESULT/);
assert.deepEqual(parseClaudeOutput('work\nUSAGE_MAX_RESULT: {"outcome":"continue","checkpoint":{"version":1,"path":"cp","digest":"abc12345"}}').value, { outcome: "continue", checkpoint: { version: 1, path: "cp", digest: "abc12345" } });
assert.equal(parseClaudeOutput("done without marker").parsed, false);
console.log("Claude headless adapter tests passed");
