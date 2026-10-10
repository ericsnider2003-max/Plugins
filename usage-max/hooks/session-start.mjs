#!/usr/bin/env node
// Fail-open SessionStart marker. Reports the hub model actually configured (and where it came from),
// compares it with profiles/settings.enforced.json (single source of truth), and flags anything above
// the Opus 5.5 ceiling. Never blocks the session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve from this file, not CLAUDE_PLUGIN_ROOT: that env var can be inherited from another plugin's process.
const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function aboveCeiling(model) {
  const name = String(model || "").toLowerCase();
  if (name.includes("fable")) return true;
  const m = name.match(/opus-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (!m) return false;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0) > 5.5;
}

try {
  let input = {};
  try {
    const raw = await readStdin();
    if (process.env.USAGE_MAX_HOOK_DEBUG) {
      try {
        fs.appendFileSync(process.env.USAGE_MAX_HOOK_DEBUG, `${JSON.stringify({ hook: "SessionStart", ts: new Date().toISOString(), raw })}\n`);
      } catch {}
    }
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  const home = process.env.USAGE_MAX_HOME || os.homedir();
  const settings = readJson(path.join(home, ".claude", "settings.json")) || {};
  const profile = readJson(path.join(pluginRoot, "profiles", "settings.enforced.json")) || {};
  // Missing/unreadable profile falls back to the strict defaults, never to "anything goes".
  const expected = profile.model || "claude-opus-5-5";
  const expectedOpusAlias = (profile.env && profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL) || "claude-opus-5-5";

  let model = null;
  let source = null;
  if (input.model) [model, source] = [typeof input.model === "string" ? input.model : input.model.id, "session"];
  else if (process.env.ANTHROPIC_MODEL) [model, source] = [process.env.ANTHROPIC_MODEL, "env"];
  else if (settings.model) [model, source] = [settings.model, "settings"];
  else [model, source] = ["unset", "none"];

  const opusAlias = (settings.env && settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL) || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || null;
  const gov = readJson(path.join(home, ".claude", "usage-max", "governor.json"), null);
  const budgetMode = gov && gov.mode ? gov.mode : "green";
  const enforced = budgetMode !== "green" || settings.model === expected && (!expectedOpusAlias || opusAlias === expectedOpusAlias);
  const notes = [];
  if (!enforced) notes.push(`profile not applied (expected model=${expected}${expectedOpusAlias ? `, opus alias=${expectedOpusAlias}` : ""}); run /usage-max:rescue apply`);
  if (aboveCeiling(model)) notes.push(`model ${model} is ABOVE the Opus 5.5 ceiling — switch with /model ${expected}`);
  if (source !== "session") notes.push("a --model flag or /model switch is not visible here; the status line shows the live model and the ledger hook warns if a turn runs above the ceiling");

  console.log(`usage-max routing-active model=${model} (${source}) profile=${enforced ? "enforced" : "not-applied"} budget=${budgetMode} ceiling=opus-5.5 subagents=haiku,sonnet${notes.length ? ` — ${notes.join("; ")}` : ""}`);
  process.exitCode = 0;
} catch {
  process.exitCode = 0;
}
