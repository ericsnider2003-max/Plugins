#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-codex-notify-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true }); const f = path.join(home, ".usage-max", "notifications.jsonl");
fs.writeFileSync(f, `${JSON.stringify({ noticeId: "n1", kind: "task-health", message: "checkpoint required", deliveredAt: null })}\n`);
const out = execFileSync(process.execPath, [path.join(process.cwd(), "codex", "scripts", "codex-hook.mjs"), "UserPromptSubmit"], { env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex") }, input: JSON.stringify({ session_id: "s1", cwd: home, prompt: "continue" }), encoding: "utf8" });
assert.match(out, /checkpoint required/); assert.ok(JSON.parse(fs.readFileSync(f, "utf8")).deliveredAt); console.log("Codex notification hook tests passed");
