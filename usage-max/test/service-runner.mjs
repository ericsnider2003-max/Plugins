#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireServiceLock, DEFAULT_INTERVAL_MS, runService } from "../scripts/service-runner.mjs";
assert.equal(DEFAULT_INTERVAL_MS, 5 * 60 * 1000);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-runner-")); let calls = 0; const seenIntervals = [];
const result = await runService({ home, intervalMs: 1000, maxTicks: 2, capture: false, tickFn: async ({ intervalMs }) => { calls += 1; seenIntervals.push(intervalMs); return { mode: "observation-only" }; }, sleepFn: async () => {} });
assert.equal(calls, 2); assert.equal(result.ticks, 2); assert.deepEqual(seenIntervals, [1000, 1000]);
const held = acquireServiceLock(home); await assert.rejects(() => runService({ home, intervalMs: 1000, maxTicks: 1, capture: false, tickFn: async () => ({}) }), /already running/); held.release();
let stopped = false; const halted = await runService({ home, intervalMs: 1000, capture: false, shouldStop: () => stopped, tickFn: async () => { stopped = true; return {}; }, sleepFn: async () => {} }); assert.equal(halted.ticks, 1);
console.log("service runner tests passed");
