#!/usr/bin/env node
// LIVE: measure startup context (what every session pays before doing anything) and confirm the cache TTL.
// Runs three one-turn sessions: normal, --safe-mode (no plugins/skills/hooks/MCP/CLAUDE.md), --bare.
// The difference normal − safe-mode is what your plugins, skills, MCP servers and CLAUDE.md cost per session.
// Spends a small amount of real usage. Usage: node test/baseline.mjs [--model claude-opus-5-5]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mi = process.argv.indexOf("--model");
const model = mi > -1 ? process.argv[mi + 1] : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-baseline-"));
const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", shell: process.platform === "win32" });
if (!/"loggedIn":\s*true/.test(auth.stdout || "")) {
  console.log("BLOCKED: claude is not logged in. Run `claude` then `/login`, and re-run.");
  process.exit(3);
}
function once(label, extra) {
  const args = ["-p", "Reply with exactly: ok", "--output-format", "json", "--max-turns", "1", ...(model ? ["--model", model] : []), ...extra];
  const r = spawnSync("claude", args.map((a) => (process.platform === "win32" && /\s/.test(a) ? `"${a}"` : a)), { cwd: work, encoding: "utf8", shell: process.platform === "win32", input: "", timeout: 300000 });
  let j = {};
  try { j = JSON.parse(r.stdout); } catch { console.log(`${label}: could not parse output: ${(r.stdout || r.stderr || "").slice(0, 200)}`); return null; }
  const u = j.usage || {};
  const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const cc = u.cache_creation || {};
  const row = { label, ctx, created: u.cache_creation_input_tokens || 0, read: u.cache_read_input_tokens || 0, ttl5m: cc.ephemeral_5m_input_tokens || 0, ttl1h: cc.ephemeral_1h_input_tokens || 0, models: Object.keys(j.modelUsage || {}).join(","), error: j.is_error ? j.result : null };
  console.log(`${label.padEnd(10)} context=${String(row.ctx).padStart(7)}  written=${row.created} (5m:${row.ttl5m} 1h:${row.ttl1h})  read=${row.read}  model=${row.models}${row.error ? `  ERROR ${row.error}` : ""}`);
  return row;
}
const normal = once("normal", []);
const safe = once("safe-mode", ["--safe-mode"]);
const bare = once("bare", ["--bare"]);
if (normal && safe) {
  const overhead = normal.ctx - safe.ctx;
  console.log(`\nplugins + skills + MCP + CLAUDE.md + hooks cost ${overhead} tokens per session start (${((100 * overhead) / Math.max(normal.ctx, 1)).toFixed(0)}% of startup context).`);
  console.log(`cache TTL in use for the main conversation: ${normal.ttl5m && !normal.ttl1h ? "5m" : normal.ttl1h && !normal.ttl5m ? "1h" : "mixed/unknown"}`);
}
if (bare) console.log(`bare-mode startup context: ${bare.ctx}`);
console.log(`workdir: ${work}`);
