#!/usr/bin/env node
import assert from "node:assert/strict";
import { runTaskOnce } from "../scripts/worker-loop.mjs";
const now = "2026-10-15T08:00:00Z";
const obs = { state: "governing", authority: "provider", freshness: "fresh", capturedAt: now, model: { known: true, canonical: "gpt-5.6-luna" }, window: { usedPercentage: 30 } };
const ok = await runTaskOnce({ taskId: "task-worker-001", idempotencyKey: "idem-worker-001", observation: obs, accountApproved: true, now, execute: async () => ({ effects: [{ effectId: "effect-1", kind: "write", state: "committed" }], checkpoint: { version: 1, path: "checkpoint.json", digest: "digest-1" } }) });
assert.equal(ok.started, true); assert.equal(ok.task.state, "running"); assert.equal(ok.task.effects[0].state, "committed"); assert.equal(ok.task.lease, null);
const paused = await runTaskOnce({ taskId: "task-worker-002", idempotencyKey: "idem-worker-002", observation: { ...obs, state: "quarantined" }, accountApproved: true, now, execute: async () => { throw new Error("must not run"); } });
assert.equal(paused.started, false); assert.match(paused.decision.reason, /quarantined/);
const failed = await runTaskOnce({ taskId: "task-worker-003", idempotencyKey: "idem-worker-003", observation: obs, accountApproved: true, now, execute: async () => { throw new Error("worker failed"); } });
assert.equal(failed.started, true); assert.equal(failed.task.state, "failed"); assert.equal(failed.task.lease, null);
const verified = await runTaskOnce({ taskId: "task-worker-004", idempotencyKey: "idem-worker-004", observation: obs, accountApproved: true, now, execute: async () => ({ outcome: "completed", effects: [{ effectId: "effect-4", kind: "tests", state: "committed" }] }), requiredEffectIds: ["effect-4"], verify: async () => ({ checks: [{ name: "tests", passed: true, evidence: "test suite passed" }] }) });
assert.equal(verified.task.state, "completed"); assert.equal(verified.verification.complete, true);
const unverified = await runTaskOnce({ taskId: "task-worker-005", idempotencyKey: "idem-worker-005", observation: obs, accountApproved: true, now, execute: async () => ({ outcome: "completed", effects: [{ effectId: "effect-5", kind: "tests", state: "committed" }] }), verify: async () => ({ checks: [{ name: "tests", passed: false, evidence: "test failed" }] }) });
assert.equal(unverified.task.state, "verifying"); assert.equal(unverified.verification.complete, false);
const checkpointOnly = await runTaskOnce({ taskId: "task-worker-006", idempotencyKey: "idem-worker-006", observation: obs, accountApproved: true, now, execute: async () => ({ checkpoint: { version: 2, path: "checkpoint-2.json", digest: "digest-2" } }), verify: async () => { throw new Error("must not verify an unfinished checkpoint"); } });
assert.equal(checkpointOnly.task.state, "running"); assert.equal(checkpointOnly.verification, null);
console.log("worker loop tests passed");
