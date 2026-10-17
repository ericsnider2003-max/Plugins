#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentReservations, releaseBudget, reserveBudget } from "../scripts/reservations.mjs";
import { runTaskOnce } from "../scripts/worker-loop.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-reservations-")); const now = "2026-10-15T08:00:00Z";
const a = reserveBudget(home, { reservationId: "r-001", taskId: "task-r-001", accountSlot: "openai-primary", windowId: "weekly", usedPercent: 70, amountPercent: 15, expiresAt: "2026-10-15T09:00:00Z", now }); assert.equal(a.allowed, true);
const b = reserveBudget(home, { reservationId: "r-002", taskId: "task-r-002", accountSlot: "openai-primary", windowId: "weekly", usedPercent: 70, amountPercent: 15, expiresAt: "2026-10-15T09:00:00Z", now }); assert.equal(b.allowed, false);
assert.equal(releaseBudget(home, "r-001", { now }).released, true); assert.equal(currentReservations(home).find((x) => x.reservationId === "r-001").state, "released");
const task = { taskId: "task-r-003", state: "queued", attempt: 0, checkpoint: { version: 0, path: "x", digest: "pending0" }, effects: [], idempotencyKey: "idem-r-003" };
const result = await runTaskOnce({ task, observation: { state: "governing", authority: "provider", freshness: "fresh", capturedAt: now, account: { slot: "openai-primary" }, model: { known: true, canonical: "gpt-5.6-luna" }, window: { id: "weekly", usedPercentage: 40 } }, accountApproved: true, now, reservation: { home, amountPercent: 10 }, execute: async () => ({ checkpoint: { version: 1, path: "x", digest: "digest-0001" } }) });
assert.equal(result.started, true); assert.equal(currentReservations(home).find((x) => x.taskId === "task-r-003").state, "released");
console.log("budget reservation tests passed");
