#!/usr/bin/env node
import assert from "node:assert/strict";
import { inspectHealth } from "../scripts/watchdog.mjs";
import { nextWake } from "../scripts/scheduler.mjs";
const now = Date.parse("2026-10-15T08:00:00Z");
assert.equal(inspectHealth({ now, lastHeartbeatAt: "2026-10-15T07:59:00Z", lastMeaningfulAt: "2026-10-15T07:59:00Z" }).action, "continue");
assert.equal(inspectHealth({ now, lastHeartbeatAt: "2026-10-15T07:50:00Z", lastMeaningfulAt: "2026-10-15T07:50:00Z" }).action, "pause-and-checkpoint");
assert.equal(inspectHealth({ now, failures: 3 }).action, "circuit-open");
assert.equal(inspectHealth({ now, repeatedToolCalls: 5 }).reasons.includes("repeated-tool-loop"), true);
assert.equal(inspectHealth({ now, contextTokens: 91, contextLimit: 100 }).reasons.includes("context-cliff"), true);
const obs = { state: "observing", authority: "provider", freshness: "fresh", capturedAt: "2026-10-15T07:59:00Z", window: { resetsAt: "2026-10-15T10:00:00Z" } };
assert.equal(nextWake({ observation: obs, now }).state, "waiting-for-reset");
assert.equal(nextWake({ observation: { ...obs, authority: "local-activity" }, now }).state, "needs-observation");
assert.equal(nextWake({ observation: { ...obs, freshness: "stale" }, now }).state, "needs-observation");
assert.equal(nextWake({ observation: { ...obs, capturedAt: "2026-10-15T07:00:00Z" }, now }).state, "needs-observation");
assert.equal(nextWake({ observation: null, now }).state, "needs-observation");
console.log("watchdog and scheduler tests passed");
