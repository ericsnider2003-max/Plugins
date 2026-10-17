#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { autoObserve } from "../scripts/auto-observe.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-auto-observe-"));
const result = await autoObserve({ home, now: Date.parse("2026-10-15T08:00:00Z"), input: { hook_event_name: "SessionStart", surface: "codex-cli" } });
assert.equal(result.mode, "observation-only"); assert.equal(JSON.parse(fs.readFileSync(path.join(home, ".usage-max", "service.json"), "utf8")).running, false); assert.equal(JSON.parse(fs.readFileSync(path.join(home, ".usage-max", "activation.json"), "utf8")).surface, "codex-cli");
const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8")); const text = JSON.stringify(hooks); assert.match(text, /auto-observe\.mjs/); assert.match(fs.readFileSync("codex/scripts/codex-hook.mjs", "utf8"), /auto-observe/);
console.log("automatic observation hook tests passed");
