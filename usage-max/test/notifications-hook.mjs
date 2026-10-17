#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-notify-hook-")); const d = path.join(home, ".usage-max"); fs.mkdirSync(d, { recursive: true }); const file = path.join(d, "notifications.jsonl");
fs.writeFileSync(file, `${JSON.stringify({ noticeId: "n1", kind: "task-wake", message: "resume after reset", deliveredAt: null })}\n`);
const out = JSON.parse(execFileSync(process.execPath, [path.join(process.cwd(), "hooks", "notifications.mjs")], { env: { ...process.env, USAGE_MAX_HOME: home }, encoding: "utf8" })); assert.match(out.hookSpecificOutput.additionalContext, /resume after reset/); assert.ok(JSON.parse(fs.readFileSync(file, "utf8")).deliveredAt);
assert.equal(execFileSync(process.execPath, [path.join(process.cwd(), "hooks", "notifications.mjs")], { env: { ...process.env, USAGE_MAX_HOME: home }, encoding: "utf8" }), "");
console.log("notification hook tests passed");
