#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseDestination, routePausedTask } from "../scripts/cross-provider.mjs";
const now = Date.parse("2026-10-15T08:00:00Z"); const task = { taskId: "cross-1", state: "paused_for_usage", provider: "anthropic", surface: "claude-code", idempotencyKey: "cross-idem", checkpoint: { version: 1, path: "checkpoint", digest: "digest-1" }, effects: [] };
const codex = { provider: "openai", surface: "codex-cli", account: { slot: "openai-primary", approved: true }, authority: "provider", state: "governing", freshness: "fresh", capturedAt: "2026-10-15T07:59:00Z", model: { known: true, canonical: "gpt-5.6-luna", effort: "medium" }, window: { usedPercentage: 20, resetsAt: "2026-10-20T08:00:00Z" } };
assert.equal(chooseDestination({ task, observations: [codex], now }).allowed, true); assert.match(chooseDestination({ task, observations: [codex], now }).reason, /lowest-usage/); assert.equal(chooseDestination({ task, observations: [{ ...codex, freshness: "stale" }], now }).allowed, false);
assert.equal(chooseDestination({ task, observations: [codex], accountPolicy: [{ slot: "openai-primary", routingEnabled: false }], now }).allowed, false);
assert.equal(chooseDestination({ task, observations: [codex], accountPolicy: [{ slot: "openai-primary", routingEnabled: true, cooldownUntil: "2026-10-15T09:00:00Z" }], now }).allowed, false);
assert.equal(chooseDestination({ task, observations: [codex], accountPolicy: [{ slot: "other-account", routingEnabled: true }], now }).allowed, false);
assert.equal(chooseDestination({ task, observations: [{ ...codex, model: { ...codex.model, raw: "claude-sonnet-5-5", provider: "unknown" } }], now }).allowed, false);
assert.equal(chooseDestination({ task: { ...task, requestedModel: "gpt-5.6-sol" }, observations: [codex], now }).allowed, false);
const constrained = chooseDestination({ task, observations: [{ ...codex, window: { ...codex.window, usedPercentage: 95 } }], now }); assert.equal(constrained.allowed, false); assert.equal(constrained.conservative, true);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-cross-")); const routed = routePausedTask({ home, task, observations: [codex], now, nextAction: "resume checkpoint" }); assert.equal(routed.handedOff, true); assert.equal(routed.task.state, "handoff_pending"); assert.equal(routed.pack.credentialsIncluded, false);
console.log("cross-provider routing tests passed");
