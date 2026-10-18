#!/usr/bin/env node
import assert from "node:assert/strict";
import { reconcileObservations } from "../scripts/reconcile.mjs";
const p = { provider: "openai", account: { slot: "openai-primary" }, capturedAt: "2026-10-15T08:00:00Z", authority: "provider", state: "observing", window: { id: "weekly", usedPercentage: 70 } };
const same = { provider: "openai", account: { slot: "openai-primary" }, capturedAt: "2026-10-15T08:01:00Z", authority: "local-activity", state: "observing", data: { usedPercentage: 72 } };
assert.equal(reconcileObservations([p, same], { now: Date.parse("2026-10-15T08:05:00Z") })[0].status, "consistent");
const conflict = { ...same, capturedAt: "2026-10-15T08:02:00Z", data: { usedPercentage: 20 } };
assert.equal(reconcileObservations([p, conflict], { now: Date.parse("2026-10-15T08:05:00Z") })[0].status, "conflict");
assert.equal(reconcileObservations([p], { now: Date.parse("2026-10-15T08:05:00Z") })[0].status, "unattributed");
assert.equal(reconcileObservations([{ ...p, capturedAt: "2026-10-15T07:00:00Z" }], { now: Date.parse("2026-10-15T08:00:00Z") })[0].status, "stale");
assert.equal(reconcileObservations([{ ...p, window: { ...p.window, usedPercentage: 101 } }], { now: Date.parse("2026-10-15T08:05:00Z") })[0].status, "invalid");
const p0 = { ...p, capturedAt: "2026-10-15T07:00:00Z", window: { ...p.window, usedPercentage: 40 } }; const p1 = { ...p, capturedAt: "2026-10-15T07:30:00Z", window: { ...p.window, usedPercentage: 55 } };
const moved = reconcileObservations([p0, p1], { now: Date.parse("2026-10-15T07:31:00Z") }).find((x) => x.providerCapturedAt === p1.capturedAt); assert.equal(moved.anomaly, "provider-movement-without-local"); assert.equal(moved.providerMovementPct, 15);
console.log("reconciliation tests passed");
