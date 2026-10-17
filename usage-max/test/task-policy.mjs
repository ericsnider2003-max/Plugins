#!/usr/bin/env node
import assert from "node:assert/strict";
import { canAdmit } from "../scripts/admission.mjs";
import { dependencyDecision, retryDecision, retryDelay } from "../scripts/task-policy.mjs";
import { runTaskOnce } from "../scripts/worker-loop.mjs";
const base = { taskId: "policy-task-001", state: "queued", dependencies: ["dep-001"], retry: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 8000 }, attempt: 0 };
assert.equal(dependencyDecision(base, new Map([["dep-001", { state: "running" }]])).allowed, false); assert.equal(dependencyDecision(base, new Map([["dep-001", { state: "completed" }]])).allowed, true);
assert.equal(retryDecision({ ...base, state: "failed", attempt: 1 }).allowed, true); assert.equal(retryDecision({ ...base, state: "failed", attempt: 2 }).allowed, false); assert.equal(retryDelay({ ...base, attempt: 1 }), 2000);
const observation = { state: "governing", authority: "provider", freshness: "fresh", capturedAt: "2026-10-15T08:00:00Z", model: { known: true, canonical: "gpt-5.6-luna" }, window: { usedPercentage: 20 } }; assert.equal(canAdmit({ task: base, tasks: new Map(), observation, accountApproved: true, now: Date.parse("2026-10-15T08:01:00Z") }).allowed, false);
const failed = await runTaskOnce({ task: { ...base, dependencies: [], state: "queued" }, observation, accountApproved: true, now: "2026-10-15T08:00:00Z", execute: async () => { const error = new Error("transient"); error.retryable = true; throw error; } }); assert.equal(failed.task.state, "failed"); assert.ok(failed.task.retryAt);
const held = await runTaskOnce({ task: failed.task, observation, accountApproved: true, now: "2026-10-15T08:00:01Z", execute: async () => ({}) }); assert.equal(held.started, false); assert.match(held.decision.reason, /backoff/);
const selected = await runTaskOnce({ task: { ...base, dependencies: [], state: "queued", requestedModel: "gpt-5.6-luna", requestedEffort: "medium" }, observation: { ...observation, provider: "openai", surface: "codex-cli", model: { known: true, canonical: "gpt-5.6-sol", effort: "high" } }, accountApproved: true, now: "2026-10-15T08:00:00Z", execute: async () => { throw new Error("must not run with a different requested model"); } }); assert.equal(selected.started, false); assert.match(selected.decision.reason, /requested model/); assert.equal(selected.task.modelDecision.status, "unavailable");
console.log("task dependency and retry policy tests passed");
