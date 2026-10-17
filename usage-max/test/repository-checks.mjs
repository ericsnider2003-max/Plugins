#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRepositoryCheck } from "../scripts/repository-checks.mjs";
import { executeRepositoryAction } from "../scripts/repository-actions.mjs";
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-repo-checks-")); fs.mkdirSync(path.join(cwd, ".usage-max"), { recursive: true }); fs.writeFileSync(path.join(cwd, ".usage-max", "subagents.jsonl"), `${JSON.stringify({ id: "a", state: "closed" })}\n`); assert.equal(runRepositoryCheck("subagents-closed", { cwd }).passed, true); assert.equal(runRepositoryCheck("install", { cwd }).passed, false); assert.equal(runRepositoryCheck("unknown", { cwd }).passed, false);
const calls = []; const spawn = (file, args) => { calls.push({ file, args }); return { status: 0, stdout: "ok", stderr: "" }; };
const denied = executeRepositoryAction("commit", { cwd, allowMutations: false, files: ["tracked.txt"], commitMessage: "test", spawn }); assert.equal(denied.executed, false); assert.equal(calls.length, 0);
const invalid = executeRepositoryAction("commit", { cwd, allowMutations: true, files: ["../outside.txt"], commitMessage: "test", spawn }); assert.equal(invalid.executed, false); assert.match(invalid.reason, /explicit/);
const committed = executeRepositoryAction("commit", { cwd, allowMutations: true, files: ["tracked.txt"], commitMessage: "test", spawn }); assert.equal(committed.passed, true); assert.deepEqual(calls.at(-1).args.slice(0, 3), ["commit", "-m", "test"]);
const install = executeRepositoryAction("install", { cwd, allowMutations: true, spawn }); assert.equal(install.executed, false); assert.match(install.reason, /package\.json/);
console.log("repository check adapter tests passed");
