#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeSubagent, currentSubagents, heartbeatSubagent, reconcileSubagents, startSubagent } from "../scripts/subagents.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-subagents-")); const start = startSubagent(home, { subagentId: "subagent-001", taskId: "task-001", now: "2026-10-15T07:00:00Z" }); assert.equal(start.duplicate, false); assert.equal(startSubagent(home, { subagentId: "subagent-001", now: "2026-10-15T07:01:00Z" }).duplicate, true);
assert.equal(heartbeatSubagent(home, "subagent-001", "2026-10-15T07:05:00Z").updated, true); assert.equal(reconcileSubagents(home, { now: Date.parse("2026-10-15T08:00:00Z"), staleMs: 30 * 60 * 1000 }).stale.length, 1); assert.equal(currentSubagents(home)[0].state, "failed"); assert.equal(closeSubagent(home, "subagent-001").closed, false);
console.log("subagent lifecycle tests passed");
