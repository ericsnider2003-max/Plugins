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
import { ttlAdvice } from "./ttl.mjs";
import { ownedSet, loadApplied, saveApplied } from "./owned.mjs";

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

// Returns the merged settings, what changed, and which keys were kept because YOU set them (ownership: see owned.mjs).
export function computeProfile(settings, { profile, launcher, modelWant = null, autoCompactWindow = null, applied = {}, tighten = false }) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  const changes = [], kept = [];
  const set = (keyPath, value) => {
    const before = JSON.stringify(keyPath.split(".").reduce((x, k) => (x == null ? undefined : x[k]), next));
    const r = ownedSet(next, keyPath, value, applied);
    if (r === "set") changes.push(`${keyPath}: ${before} -> ${JSON.stringify(value)}`);
    else if (r === "kept") kept.push(`${keyPath} (yours: ${before}; profile wants ${JSON.stringify(value)})`);
  };
  for (const [key, value] of Object.entries(profile)) {
    if (key === "$comment" || OWNED_BY_GOVERNOR.has(key)) continue;
    if (key === "env") for (const [k, v] of Object.entries(value)) set(`env.${k}`, v);
    else set(key, value);
  }
  if (modelWant) {
    const before = JSON.stringify([next.model, next.effortLevel, next.modelSettings]);
    if (patchModel(next, modelWant, applied, tighten)) changes.push(`model/effort: ${before} -> ${JSON.stringify([next.model, next.effortLevel, next.modelSettings])}`);
  }
  if (Number.isFinite(autoCompactWindow) && autoCompactWindow >= 100000 && autoCompactWindow <= 1000000) set("autoCompactWindow", autoCompactWindow);
  const sl = next.statusLine;
  const ours = { type: "command", command: `node "${fwd(launcher)}"` };
  if (!sl) { next.statusLine = ours; changes.push(`statusLine: undefined -> ${JSON.stringify(ours)}`); }
  else if (typeof sl.command === "string" && sl.command.includes("usage-max.") === false && /[\\/]\.claude[\\/]usage-max[\\/]statusline\.mjs/.test(sl.command)) { if (JSON.stringify(sl) !== JSON.stringify(ours)) { next.statusLine = ours; changes.push(`statusLine: ${JSON.stringify(sl)} -> ${JSON.stringify(ours)}`); } }
  else if (JSON.stringify(sl) !== JSON.stringify(ours)) kept.push("statusLine (you already have your own; the governor then needs `budget calibrate`)");
  if (!next.extraKnownMarketplaces || !next.extraKnownMarketplaces[MARKETPLACE.name]) {
    next.extraKnownMarketplaces = { ...(next.extraKnownMarketplaces || {}), [MARKETPLACE.name]: { source: { source: "github", repo: MARKETPLACE.repo }, autoUpdate: true } };
    changes.push(`extraKnownMarketplaces.${MARKETPLACE.name}: added (auto-update on)`);
  }
  return { next, changes, kept };
}

export async function apply({ write = false, home = homeDir(), root = pluginRoot } = {}) {
  const file = path.join(home, ".claude", "settings.json");
  const existed = fs.existsSync(file);
  const settings = existed ? readJson(file, null) : {};
  if (settings === null) return { error: `${file} is not valid JSON; not touching it`, changes: [], wrote: false };
  const profile = readJson(path.join(root, "profiles", "settings.enforced.json"), {});
  // Cache lifetime follows the user's own sessions (5m vs 1h replay), not a hardcoded guess; keeps the profile default until there is enough data.
  let ttl = null;
  const ttlFile = path.join(dataDir(home), "ttl.json"), cached = readJson(ttlFile, null); // replaying every transcript is slow: reuse for 6h
  if (cached && Date.now() - cached.at < 6 * 3600e3) ttl = cached.value;
  else { try { ttl = await ttlAdvice(path.join(home, ".claude", "projects")); if (write) writeJsonAtomic(ttlFile, { at: Date.now(), value: ttl }); } catch {} }
  if (ttl && ttl.recommend) profile.promptCacheTtl = ttl.recommend;
  const launcher = path.join(dataDir(home), "statusline.mjs");
  const config = loadConfig();
  const gst = loadState();
  const modelWant = config.manageSettings ? config.modes[gst.mode === "green" && gst.surplus ? "surplus" : gst.mode] || null : null;
  const appliedFile = path.join(dataDir(home), "applied.json"), applied = loadApplied(appliedFile);
  const acw = Number(readJson(path.join(dataDir(home), "config.json"), {}).autoCompactWindow);
  const { next, changes, kept } = computeProfile(settings, { profile, launcher, modelWant, autoCompactWindow: Number.isFinite(acw) && acw > 0 ? acw : null, applied, tighten: gst.mode === "amber" || gst.mode === "red" });
  const real = changes;
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
    saveApplied(appliedFile, applied);
  }
  return { file, existed, changes, kept, wrote, backup, ttl };
}

export function autoApplyEnabled(home = homeDir()) {
  if (process.env.USAGE_MAX_AUTOAPPLY === "off") return false;
  return readJson(path.join(dataDir(home), "config.json"), {}).autoApply !== false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await apply({ write: process.argv.includes("--write") });
  if (r.error) { console.log(r.error); process.exit(1); }
  console.log(`${r.file}${r.existed ? "" : " (does not exist yet; will be created)"}`);
  if (r.ttl) console.log(r.ttl.recommend ? `  cache lifetime: ${r.ttl.recommend} (replayed ${r.ttl.sessions} of your sessions: 5m would change cost by ${r.ttl.savedByFiveMin >= 0 ? "-" : "+"}$${Math.abs(r.ttl.savedByFiveMin).toFixed(2)})` : `  cache lifetime: keeping the default until there are 5+ sessions to learn from (${r.ttl.sessions} so far)`);
  console.log(r.changes.length ? r.changes.map((c) => `  ${c}`).join("\n") : "  already up to date");
  for (const k of r.kept || []) console.log(`  kept (your value wins): ${k}`);
  console.log(r.wrote ? `applied${r.backup ? ` (backup: ${r.backup})` : ""}. Takes effect in NEW sessions.` : process.argv.includes("--write") ? "nothing to write." : "dry run. Re-run with --write to apply.");
}
