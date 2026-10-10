// Codex loads Claude-format plugins natively and runs their hooks (it even sets CLAUDE_PLUGIN_ROOT "for OOTB compat").
// So the Claude hooks can end up running INSIDE Codex, where they must do nothing: Codex has its own hooks (codex/).
// Override for tests: USAGE_MAX_HOST=claude|codex.
export function underCodex(input = {}) {
  if (process.env.USAGE_MAX_HOST === "claude") return false;
  if (process.env.USAGE_MAX_HOST === "codex") return true;
  if (input && typeof input === "object" && "turn_id" in input) return true; // Codex hook payloads carry turn_id
  return Boolean(process.env.PLUGIN_ROOT) && !process.env.CLAUDECODE; // Codex sets PLUGIN_ROOT for plugin hooks; Claude Code sets CLAUDECODE
}
