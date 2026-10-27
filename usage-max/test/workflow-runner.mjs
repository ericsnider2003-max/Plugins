import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflow } from "../scripts/workflow-runner.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-workflow-runner-"));
const observation = { provider: "anthropic", surface: "claude-code", state: "governing", authority: "provider", freshness: "fresh", capturedAt: "2026-10-26T08:00:00Z", account: { slot: "anthropic-primary" }, model: { provider: "anthropic", known: true, canonical: "claude-sonnet-5-5" }, window: { id: "five_hour", usedPercentage: 20 }, windows: { five_hour: { id: "five_hour", usedPercentage: 20 } } };
let calls = 0;
const worker = async ({ stageId }) => { calls++; return { outcome: stageId === "verify" ? "completed" : "continue", checkpoint: { version: calls, path: `cp-${stageId}`, digest: `digest-${stageId}` }, effects: [{ effectId: `effect-${stageId}`, kind: "stage", state: "committed" }] }; };
const result = await runWorkflow({ home, taskId: "wf-1", idempotencyKey: "wf-1-key", stages: ["scout", "verify"], observation, accountApproved: true, worker, verify: async () => ({ checks: [{ name: "stage", passed: true }] }), now: "2026-10-26T08:00:00Z" });
assert.equal(result.completed, true);
assert.equal(calls, 2);
assert.equal(fs.readFileSync(path.join(home, ".usage-max", "workflows.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).length, 2);
const refused = await runWorkflow({ home, task: { executionMode: "interactive", taskId: "wf-2", state: "queued" }, taskId: "wf-2", idempotencyKey: "wf-2-key", stages: ["direct"], worker });
assert.equal(refused.started, false);
assert.match(refused.reason, /explicit unattended/);
console.log("workflow runner tests passed");
