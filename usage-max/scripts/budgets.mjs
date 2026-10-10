// Opt-in: shrink the always-loaded skill list and MCP tool descriptions (your first turn carries both).
//   usage-max budgets [status|on|off]    on = SLASH_COMMAND_TOOL_CHAR_BUDGET 4000 + CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH 1000 in ~/.claude/settings.json
// Trade-off, stated plainly: with a smaller skill budget Claude Code drops descriptions of rarely used skills, so those skills trigger less often.
// Only keys usage-max wrote are ever removed (ownership in applied.json); a value you set yourself is kept.
import path from "node:path";
import { readJson, writeJsonAtomic, dataDir } from "./meter.mjs";
import { ownedSet, ownedUnset, loadApplied, saveApplied } from "./owned.mjs";
export const KEYS = { "env.SLASH_COMMAND_TOOL_CHAR_BUDGET": "4000", "env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH": "1000" };
export function apply(settings, on, applied) {
  let changed = false;
  for (const [k, v] of Object.entries(KEYS)) { if (on) { if (ownedSet(settings, k, v, applied, false) === "set") changed = true; } else if (ownedUnset(settings, k, applied)) changed = true; }
  return changed;
}
export function status(settings) { return Object.keys(KEYS).map((k) => `${k.slice(4)} = ${k.split(".").reduce((x, p) => (x ? x[p] : undefined), settings) ?? "(default)"}`); }
export function run(args, home) {
  const file = path.join(home, ".claude", "settings.json"), s = readJson(file, null), a = args[0] || "status";
  if (a === "status" || !["on", "off"].includes(a)) { console.log((s ? status(s) : ["(no ~/.claude/settings.json here)"]).join("\n") + "\nturn on: usage-max budgets on   (smaller skill/MCP descriptions in every session; rarely used skills may trigger less often)"); return 0; }
  const settings = s || {}, af = path.join(dataDir(), "applied.json"), applied = loadApplied(af);
  const changed = apply(settings, a === "on", applied); saveApplied(af, applied);
  if (changed) writeJsonAtomic(file, settings);
  console.log(changed ? `description budgets ${a.toUpperCase()} (takes effect in NEW sessions)` : `nothing to change (already ${a}, or you set those values yourself)`); return 0;
}
