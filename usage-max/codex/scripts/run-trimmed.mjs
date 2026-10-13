#!/usr/bin/env node
// node run-trimmed.mjs run <word> <word> ...: the ORIGINAL command stays human-readable (Codex shows it, and its approval / auto-review sees
// `npm test`, not an encoded blob). Only plain words are accepted (no quotes, backslashes, globs, %, ~ ...), so PowerShell, cmd and sh all
// hand over exactly the same tokens. Runs it via the platform shell (cmd.exe on Windows, /bin/sh elsewhere), merges stdout+stderr in arrival
// order, trims, prints, exits with the child's exact code.
// Also adds AGGREGATE counters (never the command) to <dataDir>/trim-stats.json, best effort.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process"; import { fileURLToPath } from "node:url";
import { renderTrimmed } from "./trim.mjs";
export const SAFE_WORD = /^[\w@+=:,./-]+$/; // identical in PowerShell, cmd and sh; deliberately excludes quotes \ * ? [ ] { } ~ % ^ ! # and whitespace
export const words = (cmd) => (typeof cmd === "string" && cmd.trim() ? cmd.trim().split(/\s+/) : []);
// null when the command has anything but plain words: the caller then leaves the command completely untouched.
export const wrap = (cmd, runPath) => { const w = words(cmd); return w.length && w.every((x) => SAFE_WORD.test(x)) ? `node "${runPath.replace(/\\/g, "/")}" run ${w.join(" ")}` : null; };
export function recordStats(raw, out) {
  try {
    const d = path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".usage-max-codex"), f = path.join(d, "trim-stats.json"); let s = {};
    try { s = JSON.parse(fs.readFileSync(f, "utf8")) || {}; } catch {}
    s = { rewrites: (+s.rewrites || 0) + 1, rawBytes: (+s.rawBytes || 0) + raw, outBytes: (+s.outBytes || 0) + out, lastAt: new Date().toISOString() };
    fs.mkdirSync(d, { recursive: true }); const t = f + "." + process.pid + ".tmp"; fs.writeFileSync(t, JSON.stringify(s)); fs.renameSync(t, f);
  } catch {}
}
function main() {
  const w = process.argv.slice(3); // defense in depth: this is not a general command runner, it refuses anything but plain words
  if (process.argv[2] !== "run" || !w.length || !w.every((x) => SAFE_WORD.test(x))) { console.error("usage-max run-trimmed: usage: run <plain words>; nothing run"); process.exit(2); }
  const cmd = w.join(" ");
  const chunks = []; let c;
  try { c = spawn(cmd, { shell: true, stdio: ["inherit", "pipe", "pipe"] }); } catch (e) { console.error("usage-max run-trimmed: could not start command: " + e.message); process.exit(127); }
  let failed = false; c.on("error", (e) => { failed = true; console.error("usage-max run-trimmed: could not start command: " + e.message); process.exitCode = 127; });
  for (const s of [c.stdout, c.stderr]) s && s.on("data", (d) => chunks.push(d));
  c.on("close", (code, sig) => {
    if (failed) return; const raw = Buffer.concat(chunks).toString("utf8"), r = renderTrimmed(raw);
    process.stdout.write(r.text); recordStats(Buffer.byteLength(raw), Buffer.byteLength(r.text));
    process.exitCode = code !== null ? code : sig ? 128 + (os.constants.signals[sig] || -127) : 1;
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
