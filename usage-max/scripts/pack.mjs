#!/usr/bin/env node
// usage-max pack "<goal>" [--files a,b] [--test "<cmd>"] [--save] [--setup]
// Builds ONE scoped task prompt for Codex (desktop app, cloud tasks, mobile) or a ChatGPT chat: exact files, a done-test, the project-memory
// notes that match the goal, and "one pass, short reply" rules. --save writes it to .codex-tasks/<slug>.md in the repo so that, from a phone,
// the whole instruction is: "Do the task in .codex-tasks/<slug>.md". --setup prints an environment setup script for Codex cloud.
// Pure functions are exported for tests. No model, no network.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./memory.mjs";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "task";
export function changedFiles(cwd) {
  try { const r = spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }); return r.status === 0 ? r.stdout.split("\n").map((l) => l.slice(3).trim().replace(/^.* -> /, "").replace(/^"|"$/g, "")).filter(Boolean).slice(0, 15) : []; } catch { return []; }
}
export function detectTest(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  try { const p = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")); if (p.scripts && p.scripts.test && !/no test specified/.test(p.scripts.test)) return `${has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm"} test`; } catch {}
  if (has("pyproject.toml") || has("pytest.ini") || has("tox.ini")) return "pytest -q";
  if (has("go.mod")) return "go test ./..."; if (has("Cargo.toml")) return "cargo test"; return null;
}
export function buildPack({ goal, files = [], test = null, memoryText = "" }) {
  const L = [`# Task: ${goal}`, ""];
  L.push(files.length ? `Files to change: ${files.join(", ")}\nTouch other files only if the task cannot be done without it, and say which and why.` : "Find the smallest set of files that needs to change; do not survey the whole repo.");
  L.push(test ? `Done when \`${test}\` passes. Run it once at the end (and once earlier only if you need it to find the cause); do not loop on the full suite.` : "Done when the change works as described; state how you checked.");
  if (memoryText) L.push("", memoryText.replace(/^usage-max memory[^\n]*\n\n/, "Project notes that apply:\n"));
  L.push("", "Rules: one pass. Do not refactor, rename or reformat code outside the task. Do not re-read files you have already read. If something is ambiguous, pick the most conservative reading and note it, instead of stopping to ask.", "Final reply: 10 lines or fewer: what changed (file by file), the test result, anything left undone or risky.");
  return L.join("\n");
}
export function setupScript(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f)); const L = ["# Codex cloud environment setup script (paste into the environment's setup field; it runs once and is cached)", "set -e"];
  if (has("pnpm-lock.yaml")) L.push("corepack enable && pnpm install --frozen-lockfile"); else if (has("yarn.lock")) L.push("corepack enable && yarn install --frozen-lockfile"); else if (has("package-lock.json")) L.push("npm ci"); else if (has("package.json")) L.push("npm install");
  if (has("requirements.txt")) L.push("pip install -r requirements.txt"); if (has("poetry.lock")) L.push("pip install poetry && poetry install"); else if (has("pyproject.toml") && !has("requirements.txt")) L.push("pip install -e .");
  if (has("go.mod")) L.push("go mod download"); if (has("Cargo.toml")) L.push("cargo fetch");
  if (L.length === 2) L.push("# nothing to install detected");
  return L.join("\n");
}
export function run(argv, cwd = process.cwd()) {
  const a = [...argv]; const bool = (n) => { const i = a.indexOf("--" + n); if (i < 0) return false; a.splice(i, 1); return true; }; const take = (n) => { const i = a.indexOf("--" + n); if (i < 0) return null; const v = a[i + 1]; a.splice(i, v && !v.startsWith("--") ? 2 : 1); return v && !v.startsWith("--") ? v : true; };
  const setup = bool("setup"), save = bool("save"), filesArg = take("files"), testArg = take("test"); const goal = a.join(" ").trim();
  if (setup) return { out: setupScript(cwd) };
  if (!goal) return { out: 'usage: usage-max pack "<what Codex should do>" [--files a,b] [--test "<cmd>"] [--save]   |   usage-max pack --setup', code: 1 };
  const files = filesArg && filesArg !== true ? filesArg.split(",").map((x) => x.trim()).filter(Boolean) : changedFiles(cwd);
  const test = testArg && testArg !== true ? testArg : detectTest(cwd); const mem = M.findMemoryDir(cwd);
  const memoryText = mem ? M.recall(mem, goal, { max: 3, budget: 1200, loose: true }).text : "";
  const text = buildPack({ goal, files, test, memoryText });
  if (!save) return { out: text + "\n\n(Paste this into Codex. For phone use: usage-max pack ... --save, commit, then say \"Do the task in .codex-tasks/<name>.md\".)" };
  const dir = path.join(cwd, ".codex-tasks"); fs.mkdirSync(dir, { recursive: true }); let f = path.join(dir, slug(goal) + ".md"); for (let i = 2; fs.existsSync(f) && fs.readFileSync(f, "utf8") !== text + "\n"; i++) f = path.join(dir, `${slug(goal).slice(0, 44)}-${i}.md`); fs.writeFileSync(f, text + "\n");
  const rel = path.relative(cwd, f).replace(/\\/g, "/"); return { out: `saved ${rel}\nCommit and push it. Then, in the Codex app (desktop or mobile), the whole prompt is:\n  Do the task in ${rel}` };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const r = run(process.argv.slice(2)); console.log(r.out); process.exit(r.code || 0); }
