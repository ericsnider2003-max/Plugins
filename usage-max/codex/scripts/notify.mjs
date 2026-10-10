#!/usr/bin/env node
// Codex `notify` hook (agent-turn-complete): re-meter and re-evaluate; apply settings on mode change. Fail-open.
import { evaluate, applyMode, dataDir } from "./codex-governor.mjs";
import fs from "node:fs"; import path from "node:path";
try {
  const before = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "governor.json"), "utf8")).mode; } catch { return "green"; } })();
  const { mode, cfg } = evaluate();
  if (mode !== before) { applyMode(mode, cfg); fs.appendFileSync(path.join(dataDir(), "events.log"), `${new Date().toISOString()} ${before}->${mode}\n`); }
} catch {}
