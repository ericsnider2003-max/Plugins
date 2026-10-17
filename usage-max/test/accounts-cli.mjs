#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const h = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-accounts-"));
const cli = path.resolve("scripts/accounts-cli.mjs"); const env = { ...process.env, USAGE_MAX_HOME: h };
fs.mkdirSync(path.join(h, ".usage-max"), { recursive: true });
fs.writeFileSync(path.join(h, ".usage-max", "provider-limits.json"), JSON.stringify({ captures: { codex: { account: "acct-test" } } }));
let r = spawnSync(process.execPath, [cli, "add", "openai-primary", "openai", "codex-cli,codex-desktop", "C:/Users/example/.codex", "acct-1"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /approval is still required/);
r = spawnSync(process.execPath, [cli, "add-observed", "openai-observed", "openai", "codex-cli", "C:/Users/example/.codex-observed"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /observed and bound/); assert.match(r.stdout, /accounts approve openai-observed/);
r = spawnSync(process.execPath, [cli, "list"], { env, encoding: "utf8" }); assert.match(r.stdout, /approved=false/); assert.doesNotMatch(r.stdout, /example.*codex/);
r = spawnSync(process.execPath, [cli, "request-approval", "openai-observed"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /account-approval-openai-observed/); assert.match(fs.readFileSync(path.join(h, ".usage-max", "notifications.jsonl"), "utf8"), /approval required/);
r = spawnSync(process.execPath, [cli, "approve", "openai-primary"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /approved=true enabled=true/);
r = spawnSync(process.execPath, [cli, "revoke", "openai-primary"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /approved=false enabled=false/);
console.log("account CLI tests passed");
