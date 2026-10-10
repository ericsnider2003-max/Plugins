#!/usr/bin/env node
// PreToolUse(Bash): no permissionDecision on purpose, so your normal permission prompt still applies. wrap known-noisy simple commands so only head/tail/error lines reach the model. Fail-open.
// Off: USAGE_MAX_TRIM=off. Never rewrites commands containing pipes/redirects/&&/;/subshells or --no-trim marker.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { underCodex } from "../scripts/host.mjs";
import { dataDir } from "../scripts/meter.mjs";
import { isDisabled, recordRewrite } from "../scripts/trimtest.mjs";
const NOISY = /^(npm|pnpm|yarn) (install|ci|i|test|run (test|build|lint))\b|^(pip3?|uv pip|poetry) install\b|^(pytest|python3? -m pytest|go test|cargo (test|build|check)|dotnet (test|build)|mvn |gradle |docker build|npx (jest|vitest|tsc|eslint)|tsc\b|make\b)/;
export function rewrite(cmd, trimPath) {
  if (typeof cmd !== "string" || process.env.USAGE_MAX_TRIM === "off") return null;
  const c = cmd.trim();
  if (!NOISY.test(c) || /[|><;&`$()]|\n/.test(c) || /--no-trim|--reporter|--json|-q\b|--quiet/.test(c)) return null;
  return `set -o pipefail; ${c} 2>&1 | node "${trimPath.replace(/\\/g, "/")}"`;
}
try {
  const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  if (!underCodex(input) && input.tool_name === "Bash" && input.tool_input) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = dataDir(); let nc = isDisabled(dir) ? null : rewrite(input.tool_input.command, path.join(here, "..", "scripts", "trim.mjs"));
    if (nc) { const r = recordRewrite(dir, input.tool_input.command); if (r.disabled) nc = null; }
    if (nc) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...input.tool_input, command: nc } } }));
  }
} catch {}
process.exit(0);
