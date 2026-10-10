#!/usr/bin/env node
// Static acceptance checks: plugin manifest, frontmatter, profiles, hooks, scheduled flags.
// Calls `claude plugin validate` (local, no model usage). Exit nonzero on any failure.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];

function fail(name, detail = "") {
  failures.push(name);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function pass(name) {
  console.log(`pass ${name}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`parse ${path.basename(file)}`, String(error.message).slice(0, 120));
    return null;
  }
}

function frontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(`frontmatter ${path.basename(file)}`, "missing --- block");
    return null;
  }
  const data = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].trim();
  }
  return data;
}

// 1. Manifest + component paths exist.
const manifest = readJson(path.join(root, ".claude-plugin", "plugin.json"));
if (manifest) {
  if (manifest.name !== "usage-max") fail("manifest name");
  else pass("manifest name");
  const refs = [...(manifest.agents || []), ...(manifest.skills || []), ...(manifest.commands || [])];
  if (manifest.hooks) refs.push(manifest.hooks);
  let missing = 0;
  for (const ref of refs) {
    const rel = String(ref).replace(/^\.\//, "");
    if (!fs.existsSync(path.join(root, rel))) {
      missing += 1;
      fail(`missing component ${ref}`);
    }
  }
  if (missing === 0) pass("manifest component paths");
}

// 2. Agent frontmatter: name, description, tools, full model ID, no Agent tool.
const expectedModels = {
  "scout.md": "claude-haiku-5-5",
  "worker.md": "claude-sonnet-5-5",
  "reviewer.md": "claude-sonnet-5-5"
};
for (const [file, model] of Object.entries(expectedModels)) {
  const full = path.join(root, "agents", file);
  const fm = frontmatter(full);
  if (!fm) continue;
  const text = fs.readFileSync(full, "utf8");
  const hasTools = /^tools:/m.test(text);
  if (!fm.name || !fm.description || !hasTools) fail(`agent fields ${file}`);
  else if (fm.model !== model) fail(`agent model ${file}`, `got ${fm.model}`);
  else if (/^\s*-\s*Agent\s*$/m.test(text)) fail(`agent tools ${file}`, "Agent tool present");
  else pass(`agent ${file}`);
}
for (const k of ["DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", "CLAUDE_CODE_ENABLE_AWAY_SUMMARY", "CLAUDE_CODE_DISABLE_TERMINAL_TITLE", "BASH_MAX_OUTPUT_LENGTH", "CLAUDE_CODE_GOAL_CHECKIN_MINUTES"]) {
  const pe = JSON.parse(fs.readFileSync(path.join(root, "profiles", "settings.enforced.json"), "utf8"));
  if (pe.env && pe.env[k] !== undefined) pass("profile env " + k); else fail("profile env " + k, "missing");
}
// Description budget (upstream warns at 15k combined tokens; keep far under).
const descChars = ["scout.md", "worker.md", "reviewer.md"]
  .map((f) => String((frontmatter(path.join(root, "agents", f)) || {}).description || "").length)
  .reduce((a, b) => a + b, 0);
if (descChars > 6000) fail("agent description budget", `${descChars} chars`);
else pass("agent description budget");

// 3. Skill frontmatter.
const skill = frontmatter(path.join(root, "skills", "routing", "SKILL.md"));
if (skill && skill.name === "usage-max-routing" && skill.description) pass("routing skill");
else fail("routing skill");

// 4. Commands exist with descriptions.
for (const cmd of ["usage-max.md"]) {
  const fm = frontmatter(path.join(root, "commands", cmd));
  if (fm && fm.description) pass(`command ${cmd}`);
  else fail(`command ${cmd}`);
}

// 5. Hooks file: top-level hooks key, referenced scripts exist.
const hooks = readJson(path.join(root, "hooks", "hooks.json"));
if (hooks && hooks.hooks && hooks.hooks.SessionStart && hooks.hooks.PostToolUse) pass("hooks structure");
else fail("hooks structure");
for (const script of ["hooks/session-start.mjs", "hooks/ledger.mjs", "hooks/budget.mjs", "hooks/bash-trim.mjs", "scripts/profile.mjs", "scripts/usage-max.mjs", "scripts/shared.mjs"]) {
  if (fs.existsSync(path.join(root, script))) pass(`hook script ${script}`);
  else fail(`hook script ${script}`);
}

// 6. Profiles: valid JSON, enforced model, strict kill-switch, fable absent.
const enforced = readJson(path.join(root, "profiles", "settings.enforced.json"));
if (enforced && enforced.modelSettings && enforced.modelSettings["claude-opus-5-5"] && enforced.modelSettings["claude-opus-5-5"].effortLevel === "medium" && enforced.promptCacheTtl === "5m" && enforced.promptSuggestionEnabled === false && !(enforced.env && enforced.env.MAX_THINKING_TOKENS) && enforced.model === "claude-opus-5-5" && enforced.env && enforced.env.ANTHROPIC_DEFAULT_OPUS_MODEL === "claude-opus-5-5") pass("enforced profile model");
else fail("enforced profile model");
const strict = readJson(path.join(root, "profiles", "settings.strict.json"));
if (strict && strict.env && strict.env.CLAUDE_CODE_SUBAGENT_MODEL === "claude-sonnet-5-5") pass("strict kill-switch");
else fail("strict kill-switch");
const background = fs.readFileSync(path.join(root, "profiles", "background-job.md"), "utf8");
if (background.includes("--max-turns") && background.includes("--model claude-sonnet-5-5") && background.includes("schtasks")) {
  pass("background template flags");
} else {
  fail("background template flags", "requires --max-turns, --model sonnet, and schtasks fallback");
}
let fableViolations = 0;
for (const file of ["profiles/settings.enforced.json", "profiles/settings.strict.json", "skills/routing/SKILL.md", "agents/scout.md", "agents/worker.md", "agents/reviewer.md"]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  // Allowed only in an explicit prohibition ("Never use fable or best"); any other mention is a violation.
  if (/\bfable\b(?![\s]+or[\s]+best)/i.test(text)) {
    fableViolations += 1;
    fail(`fable reference in ${file}`);
  }
}
if (fableViolations === 0) pass("no fable references");

// 6b. Codex manifest: versions in sync, hooks file exists and has the Codex schema shape (deny_unknown_fields upstream).
{
  const cx = readJson(path.join(root, ".codex-plugin", "plugin.json"));
  const mk = readJson(path.join(root, "..", ".claude-plugin", "marketplace.json"));
  if (cx && manifest && cx.version === manifest.version && (!mk || mk.plugins.every((p) => p.version === manifest.version))) pass("versions in sync (claude, codex, marketplace)");
  else fail("versions out of sync", `claude ${manifest && manifest.version}, codex ${cx && cx.version}, marketplace ${mk && mk.plugins.map((p) => p.version)}`);
  const hf = cx && readJson(path.join(root, String(cx.hooks || "").replace(/^\.\//, "")));
  const okShape = hf && Object.keys(hf).every((k) => ["description", "hooks"].includes(k)) && Object.values(hf.hooks || {}).every((groups) => groups.every((g) => Object.keys(g).every((k) => ["matcher", "hooks"].includes(k)) && g.hooks.every((x) => x.type === "command" && /codex-hook\.mjs/.test(x.command) && /%PLUGIN_ROOT%/.test(x.commandWindows || ""))));
  okShape ? pass("codex hooks file shape") : fail("codex hooks file shape");
}

// 6c. Kit launchers: Windows .cmd files must avoid ( ) blocks (cmd.exe misparses parentheses inside them) and every part must exist.
{
  const kit = path.join(root, "..", "install", "kit");
  if (fs.existsSync(kit)) {
    const need = ["1-INSTALL-CLAUDE", "2-INSTALL-CODEX", "3-CHECK-EVERYTHING", "4-CALIBRATE-CLAUDE"].flatMap((n) => [`${n}.cmd`, `${n}.sh`]).concat("START-HERE.txt");
    const missing = need.filter((f) => !fs.existsSync(path.join(kit, f)));
    missing.length ? fail("kit files", `missing ${missing.join(", ")}`) : pass("kit files");
    const blocky = fs.readdirSync(kit).filter((f) => f.endsWith(".cmd")).filter((f) => fs.readFileSync(path.join(kit, f), "utf8").split("\n").some((l) => /\(\s*$/.test(l) || /^\s*\)/.test(l)));
    blocky.length ? fail("cmd launchers use ( ) blocks", blocky.join(", ")) : pass("cmd launchers avoid ( ) blocks");
  }
}

// 7. Official validator (local, no model usage).
const haveClaude = spawnSync(process.platform === "win32" ? "claude.cmd" : "claude", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
if (!haveClaude && !process.argv.includes("--require-claude")) {
  console.log("skip claude plugin validate (claude CLI not installed here; CI runs the offline checks, validate runs locally)");
} else try {
  const claudeBin = process.platform === "win32" ? "claude.cmd" : "claude";
  execFileSync(claudeBin, ["plugin", "validate", root], { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }); // .cmd requires a shell on Windows; args are fixed literals
  pass("claude plugin validate");
} catch (error) {
  fail("claude plugin validate", String(error.message).slice(0, 200));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll static checks passed");
