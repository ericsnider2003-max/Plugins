#!/usr/bin/env node
// Codex `notify` hook (agent-turn-complete): re-meter and re-evaluate; apply settings on mode change. Fail-open.
import { evaluate, applyMode, dataDir, modeKey } from "./codex-governor.mjs";
import fs from "node:fs"; import path from "node:path";
try {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "governor.json"), "utf8")); } catch { return {}; } })();
  const before = prev.appliedKey || modeKey(prev.mode || "green", prev.surplus);
  const { mode, surplus, cfg } = evaluate(); const key = modeKey(mode, surplus);
  if (key !== before) { applyMode(mode, cfg, surplus); fs.appendFileSync(path.join(dataDir(), "events.log"), `${new Date().toISOString()} ${before}->${key}\n`); }
} catch {}
