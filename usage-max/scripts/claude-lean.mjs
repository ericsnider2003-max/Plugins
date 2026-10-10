#!/usr/bin/env node
// Governed launcher for headless/batch runs: node claude-lean.mjs [--hold-red] [--force-model] <claude args...>
//  --hold-red    in RED, exit 75 without running (harness should skip/defer the job)
//  headless -p   adds --max-turns 40 (USAGE_MAX_TURNS) unless set; pass --bare yourself to skip hooks/plugins/CLAUDE.md for eval runs
//  default       injects --model for the current mode when the caller passed none; with an explicit --model
//                that is above the mode's model, downgrades it unless --force-model.
import { spawnSync } from "node:child_process";
import { evaluate, loadConfig } from "./governor.mjs";
const q = (a) => (process.platform === "win32" && /[\s"&|<>^%]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
const raw = process.argv.slice(2);
const hold = raw.includes("--hold-red"), force = raw.includes("--force-model");
const args = raw.filter((a) => a !== "--hold-red" && a !== "--force-model");
const s = evaluate();
const printMode = args.includes("-p") || args.includes("--print");
if (printMode && !args.includes("--max-turns") && !process.env.CLAUDE_CODE_MAX_TURNS) args.push("--max-turns", String(process.env.USAGE_MAX_TURNS || 40)); const mode = s.mode; const cfg = loadConfig();
if (hold && mode === "red") { console.error("usage-max: RED — run deferred (exit 75)"); process.exit(75); }
const rank = (m) => /haiku/.test(m) ? 1 : /sonnet/.test(m) ? 2 : /opus/.test(m) ? 3 : /fable/.test(m) ? 4 : 2;
const want = cfg.modes[mode].model;
const i = args.indexOf("--model");
if (i < 0) args.push("--model", want);
else if (!force && rank(args[i + 1] || "") > rank(want)) { console.error(`usage-max: ${mode.toUpperCase()} — downgrading ${args[i + 1]} -> ${want}`); args[i + 1] = want; }
const r = spawnSync("claude", args.map(q), { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
