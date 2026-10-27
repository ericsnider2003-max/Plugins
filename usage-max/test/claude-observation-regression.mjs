#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeCaptureObservation } from "../scripts/observation-adapters.mjs";

const capture = {
  source: "claude-api",
  model: { id: "claude-sonnet-5-5" },
  rate_limits: {
    weekly_scoped: { used_percentage: 3, resets_at: 1792346400 },
    seven_day: { used_percentage: 12, resets_at: 1792346400 },
    five_hour: { used_percentage: 4, resets_at: 1792166400 }
  }
};
const observation = claudeCaptureObservation(capture);
assert.equal(observation.window.id, "five_hour", "Claude observations use the primary short window");
assert.deepEqual(observation.data.rate_limits, capture.rate_limits, "all Claude windows remain available to consumers");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-claude-regression-"));
const limits = path.join(home, "limits.json");
const result = spawnSync(process.execPath, [path.join(process.cwd(), "scripts/statusline.mjs")], {
  input: JSON.stringify({ model: capture.model, rate_limits: capture.rate_limits }),
  env: { ...process.env, USAGE_MAX_HOME: home, USAGE_MAX_LIMITS_PATH: limits },
  encoding: "utf8"
});
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(limits, "utf8"))).sort(), ["capturedAt", "five_hour", "seven_day", "weekly_scoped"]);
console.log("Claude observation regression tests passed");
