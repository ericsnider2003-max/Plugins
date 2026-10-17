#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFailureHealth, recordFailure } from "../scripts/failure-health.mjs";
import { healthReport } from "../scripts/health.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-failure-health-"));
recordFailure({ home, component: "test", event: "dispatch", error: new Error("provider read failed"), now: "2026-10-17T12:00:00.000Z" });
const rows = readFailureHealth(home, { now: Date.parse("2026-10-17T12:01:00.000Z") });
assert.equal(rows.length, 1); assert.equal(rows[0].severity, "high"); assert.match(rows[0].error, /provider read failed/);
assert.equal(readFailureHealth(home, { now: Date.parse("2026-10-19T12:00:00.000Z") }).length, 0);
const health = healthReport(home, { now: Date.parse("2026-10-17T12:01:00.000Z"), activation: { startup: {}, hooks: {}, nativeHost: {}, attachmentReceiverConfigured: false } });
assert.equal(health.status, "error"); assert.equal(health.failures.length, 1); assert.match(health.next.join(";"), /governance failure/);
console.log("failure health tests passed");
