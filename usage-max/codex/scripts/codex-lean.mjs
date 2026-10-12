#!/usr/bin/env node
// Launcher: node codex-lean.mjs [--hold-red] [--bare] [codex args...]
//  --hold-red  RED -> exit 75 without running (batch/CI: defer instead of burning the week)
//  --bare      for `codex exec`: --ignore-user-config --ignore-rules (skips your config.toml MCP servers/rules/hooks for eval-style runs)
// Values are passed unquoted (Codex falls back to string when not valid TOML) so Windows quoting can't corrupt them.
// Always passes the mode's model/effort as explicit -c overrides (works with or without profiles / --ignore-user-config).
// NOTE: don't use `exec --ephemeral` if you want these runs metered (ephemeral writes no rollout file).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, applyMode } from "./codex-governor.mjs";
const q = (a) => (process.platform === "win32" && /[\s"&|<>^%]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
// -> the codex arguments for this mode. A mode with no model (null = "leave my model alone") passes NO model override at all.
export function leanArgs(rest, mc, bare = false) {
  const pre = [];
  if (mc.model && !rest.includes("--model") && !rest.includes("-m")) pre.push("-c", `model=${mc.model}`);
  if (mc.effort && !rest.some((a) => /model_reasoning_effort/.test(a))) pre.push("-c", `model_reasoning_effort=${mc.effort}`);
  const isExec = rest[0] === "exec"; const sub = isExec ? ["exec"] : [];
  const tail = isExec ? rest.slice(1) : rest; const extra = bare && isExec ? ["--ignore-user-config", "--ignore-rules"] : [];
  return [...sub, ...pre, ...extra, ...tail];
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const raw = process.argv.slice(2); const hold = raw.includes("--hold-red"), bare = raw.includes("--bare");
  const rest = raw.filter((a) => a !== "--hold-red" && a !== "--bare");
  const { mode, cfg } = evaluate(); try { applyMode(mode, cfg); } catch (e) { console.error("usage-max: could not apply the mode (" + (e && e.message) + ")"); }
  if (hold && mode === "red") { console.error("usage-max: RED — deferred (exit 75)"); process.exit(75); }
  const r = spawnSync("codex", leanArgs(rest, cfg.modes[mode], bare).map(q), { stdio: "inherit", shell: process.platform === "win32" });
  process.exit(r.status ?? 1);
}
