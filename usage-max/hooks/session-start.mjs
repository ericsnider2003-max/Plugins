#!/usr/bin/env node
// Fail-open SessionStart marker. Reports the hub model actually configured (and where it came from),
// compares it with profiles/settings.enforced.json (single source of truth), and flags anything above
// the Opus 5.5 ceiling. Never blocks the session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aboveCeiling } from "../scripts/ceiling.mjs";
import { readOther, balanceAdvice } from "../scripts/shared.mjs";
import { oldSyncedCopies, DISABLE_OLD } from "../scripts/dupes.mjs";

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
  const profile = readJson(path.join(pluginRoot, "profiles", "settings.enforced.json")) || {};
  // Missing/unreadable profile falls back to the strict defaults, never to "anything goes".
  const expected = profile.model || "claude-opus-5-5";
  const notes = [];

  // Configure ourselves: merge the profile (settings, status line, marketplace auto-update) once per session.
  let applied = null;
  try {
    const { apply, autoApplyEnabled } = await import("../scripts/profile.mjs");
    if (autoApplyEnabled(home)) applied = await apply({ write: true, home, root: pluginRoot });
  } catch {}
  if (applied && applied.wrote) notes.push(`auto-applied the usage profile (${applied.changes.filter((c) => !c.startsWith("statusLine: left")).length} settings${applied.backup ? `; backup ${applied.backup}` : ""}) — takes effect in NEW sessions`);

  try { // the old claude.ai-uploaded copy running next to this one would double every hook
    const old = oldSyncedCopies(home, pluginRoot);
    if (old.length && !/[\\/]plugins[\\/]synced[\\/]/.test(pluginRoot)) notes.push(`an older uploaded copy (usage-max ${old[0].version}) is still enabled and doubles every hook: ${DISABLE_OLD}`);
  } catch {}
  try { // Codex scripts live in a stable folder; refresh them when this plugin updated (only if Codex support was installed)
    if (fs.existsSync(path.join(home, ".usage-max-codex", "bin"))) { const { syncBin } = await import("../codex/scripts/sync.mjs"); syncBin({ root: pluginRoot, home }); }
  } catch {}
  const settings = readJson(path.join(home, ".claude", "settings.json")) || {};
  let model = null;
  let source = null;
  if (input.model) [model, source] = [typeof input.model === "string" ? input.model : input.model.id, "session"];
  else if (process.env.ANTHROPIC_MODEL) [model, source] = [process.env.ANTHROPIC_MODEL, "env"];
  else if (settings.model) [model, source] = [settings.model, "settings"];
  else [model, source] = ["unset", "none"];

  const gov = readJson(path.join(home, ".claude", "usage-max", "governor.json"));
  const budgetMode = gov && gov.mode ? gov.mode : "green";
  const calibrated = Boolean(gov && gov.calib);
  const live = readJson(path.join(home, ".claude", "usage-max", "limits.json"));
  const expectedOpusAlias = (profile.env && profile.env.ANTHROPIC_DEFAULT_OPUS_MODEL) || "claude-opus-5-5";
  const opusAlias = (settings.env && settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL) || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || null;
  // The governor deliberately moves the model in amber/red, so only GREEN requires the exact profile model.
  const enforced = budgetMode !== "green" ? Boolean(settings.model) : settings.model === expected && opusAlias === expectedOpusAlias;
  if (!enforced && !(applied && applied.wrote)) notes.push("profile not applied; run /usage-max rescue apply --write");
  if (aboveCeiling(model)) notes.push(`model ${model} is ABOVE the Opus 5.5 ceiling — switch with /model ${expected}`);
  if (!calibrated && !live) notes.push("budget is still learning: real plan % appears once the status line has rendered a reply (or /usage-max budget calibrate <pct> --resets <date>)");

  const advice = balanceAdvice({ mode: budgetMode }, readOther("codex"), Date.now(), { selfName: "Claude", otherName: "Codex", dispatch: " (codex-dispatch skill if installed)" });
  const rules = (advice ? advice + "\n" : "") + (gov && gov.surplus && budgetMode === "green" ? "usage-max surplus: allowance is going unused this week, higher effort is fine on hard problems.\n" : "") + "usage-max rules: delegate search/read/web/format to usage-max-scout (Haiku) and edits/tests/refactors to usage-max-worker (Sonnet); gate big changes with usage-max-reviewer; subagents never above Sonnet; do micro-tasks inline; keep one model per session; be terse. " + (budgetMode === "green" ? "" : `Budget is ${budgetMode.toUpperCase()}: work economically.`);
  console.log(`usage-max routing-active model=${model} (${source}) profile=${enforced || (applied && applied.wrote) ? "enforced" : "not-applied"} budget=${budgetMode} ceiling=opus-5.5${notes.length ? ` — ${notes.join("; ")}` : ""}\n${rules}`);
  process.exitCode = 0;
} catch {
  process.exitCode = 0;
}
