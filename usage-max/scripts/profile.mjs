#!/usr/bin/env node
// Applies profiles/settings.enforced.json (+ the status line and marketplace auto-update) to ~/.claude/settings.json.
// Merge, never replace: backs up the original once, only touches the keys it owns, idempotent.
//   node profile.mjs            show the diff (nothing written)
//   node profile.mjs --write    apply it
// The SessionStart hook calls apply({ write: true }) so usage-max configures itself; opt out with
// USAGE_MAX_AUTOAPPLY=off or {"autoApply": false} in ~/.claude/usage-max/config.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadState, patchModel } from "./governor.mjs";
import { readJson, writeJsonAtomic } from "./meter.mjs";

export const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const MARKETPLACE = { name: "eric-plugins", repo: "ericsnider2003-max/Plugins" };
const OWNED_BY_GOVERNOR = new Set(["model", "effortLevel", "modelSettings"]);
const fwd = (p) => p.replace(/\\/g, "/");
const homeDir = () => process.env.USAGE_MAX_HOME || os.homedir();
const dataDir = (home) => path.join(home, ".claude", "usage-max");

const LAUNCHER = `// Stable status-line entry written by usage-max. It follows plugin updates through root.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
try {
  const home = process.env.USAGE_MAX_HOME || os.homedir();
  const root = JSON.parse(fs.readFileSync(path.join(home, ".claude", "usage-max", "root.json"), "utf8")).root;
  await import(pathToFileURL(path.join(root, "scripts", "statusline.mjs")).href);
} catch {
  console.log("usage-max");
}
`;

// Pure: returns the merged settings and a human-readable change list.
export function computeProfile(settings, { profile, launcher, modelWant = null, autoCompactWindow = null }) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  const changes = [];
  const set = (key, value) => {
    if (JSON.stringify(next[key]) !== JSON.stringify(value)) {
      changes.push(`${key}: ${JSON.stringify(next[key])} -> ${JSON.stringify(value)}`);
      next[key] = value;
    }
  };
  for (const [key, value] of Object.entries(profile)) {
    if (key === "$comment" || OWNED_BY_GOVERNOR.has(key)) continue;
    if (key === "env") {
      const env = { ...(next.env || {}) };
      for (const [k, v] of Object.entries(value)) {
        if (k === "ANTHROPIC_DEFAULT_OPUS_MODEL" || env[k] !== v) env[k] = v;
      }
      set("env", env);
    } else set(key, value);
  }
  if (modelWant) {
    const before = JSON.stringify([next.model, next.effortLevel, next.modelSettings]);
    if (patchModel(next, modelWant)) changes.push(`model/effort: ${before} -> ${JSON.stringify([next.model, next.effortLevel, next.modelSettings])}`);
  }
  if (Number.isFinite(autoCompactWindow) && autoCompactWindow >= 100000 && autoCompactWindow <= 1000000) set("autoCompactWindow", autoCompactWindow);
  const sl = next.statusLine;
  if (!sl || (sl.command && sl.command.includes("usage-max"))) set("statusLine", { type: "command", command: `node "${fwd(launcher)}"` });
  else changes.push("statusLine: left alone (you already have one)");
  const km = { ...(next.extraKnownMarketplaces || {}) };
  if (!km[MARKETPLACE.name]) {
    km[MARKETPLACE.name] = { source: { source: "github", repo: MARKETPLACE.repo }, autoUpdate: true };
    set("extraKnownMarketplaces", km);
  }
  return { next, changes };
}

export function apply({ write = false, home = homeDir(), root = pluginRoot } = {}) {
  const file = path.join(home, ".claude", "settings.json");
  const existed = fs.existsSync(file);
  const settings = existed ? readJson(file, null) : {};
  if (settings === null) return { error: `${file} is not valid JSON; not touching it`, changes: [], wrote: false };
  const profile = readJson(path.join(root, "profiles", "settings.enforced.json"), {});
  const launcher = path.join(dataDir(home), "statusline.mjs");
  const config = loadConfig();
  const modelWant = config.manageSettings ? config.modes[loadState().mode] || null : null;
  const acw = Number(readJson(path.join(dataDir(home), "config.json"), {}).autoCompactWindow);
  const { next, changes } = computeProfile(settings, { profile, launcher, modelWant, autoCompactWindow: Number.isFinite(acw) && acw > 0 ? acw : null });
  const real = changes.filter((c) => !c.startsWith("statusLine: left alone"));
  let wrote = false;
  let backup = null;
  if (write) {
    fs.mkdirSync(dataDir(home), { recursive: true });
    fs.writeFileSync(launcher, LAUNCHER); // keep the stable launcher + root pointer fresh on every run
    writeJsonAtomic(path.join(dataDir(home), "root.json"), { root, version: readJson(path.join(root, ".claude-plugin", "plugin.json"), {}).version || null, at: new Date().toISOString() });
    if (real.length) {
      if (existed) {
        backup = `${file}.usage-max-backup`;
        try { fs.writeFileSync(backup, fs.readFileSync(file), { flag: "wx" }); } catch {}
      }
      writeJsonAtomic(file, next);
      wrote = true;
    }
  }
  return { file, existed, changes, wrote, backup };
}

export function autoApplyEnabled(home = homeDir()) {
  if (process.env.USAGE_MAX_AUTOAPPLY === "off") return false;
  return readJson(path.join(dataDir(home), "config.json"), {}).autoApply !== false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = apply({ write: process.argv.includes("--write") });
  if (r.error) { console.log(r.error); process.exit(1); }
  console.log(`${r.file}${r.existed ? "" : " (does not exist yet; will be created)"}`);
  console.log(r.changes.length ? r.changes.map((c) => `  ${c}`).join("\n") : "  already up to date");
  console.log(r.wrote ? `applied${r.backup ? ` (backup: ${r.backup})` : ""}. Takes effect in NEW sessions.` : process.argv.includes("--write") ? "nothing to write." : "dry run. Re-run with --write to apply.");
}
