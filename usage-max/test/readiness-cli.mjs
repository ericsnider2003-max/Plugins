#!/usr/bin/env node
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const home = os.tmpdir();
const result = spawnSync(process.execPath, [path.join(root, "scripts", "readiness-cli.mjs"), "--json"], { env: { ...process.env, USAGE_MAX_HOME: home }, encoding: "utf8" });
assert.ok(result.status === 0 || result.status === 1, `readiness CLI crashed: ${result.stderr}`);
const report = JSON.parse(result.stdout);
assert.equal(report.trial.surface, "codex-cli");
assert.notEqual(report.trial.surface, "--json");
console.log("readiness CLI tests passed");
