#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["scripts/attachment-cli.mjs", "native-host", "--extension-id", "test-extension-id"], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: process.cwd() } });
assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /"mode": "dry-run"/); assert.match(result.stdout, /test-extension-id/);
console.log("attachment CLI tests passed");
