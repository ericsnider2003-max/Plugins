#!/usr/bin/env node
// PreToolUse(Bash): see crossCheck in scripts/guard.mjs. Asks (never allows or denies on its own). Fail-open. Does nothing inside Codex.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "../scripts/meter.mjs";
import { underCodex } from "../scripts/host.mjs";
import * as G from "../scripts/guard.mjs";
async function readStdin() { if (process.stdin.isTTY) return ""; let d = ""; for await (const c of process.stdin) d += c; return d; }
try {
  let input = {}; try { const raw = await readStdin(); input = raw ? JSON.parse(raw) : {}; } catch {}
  if (underCodex(input) || input.tool_name !== "Bash") process.exit(0);
  const cmd = input.tool_input && input.tool_input.command;
  if (typeof cmd === "string" && G.CODEX_CALL.test(cmd)) {
    const gov = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "codex", "scripts", "codex-governor.mjs");
    const r = spawnSync(process.execPath, [gov, "gate"], { timeout: 6000, stdio: "ignore" });
    const msg = G.crossCheck(dataDir(), input.session_id || "unknown", cmd, r.status === 20 ? "red" : r.status === 10 ? "amber" : "green");
    if (msg) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: msg } }));
  }
} catch {}
process.exit(0);
