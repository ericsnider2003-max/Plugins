// `usage-max doctor --fix` (Claude side): clean up stale copies of usage-max that are PROVABLY older than the one running now.
//  - ~/.claude/settings.json: an enabledPlugins entry "usage-max@<x>" whose installed copy is strictly older is set to false (never deleted, so it can be turned back on).
//    Done as a one-token text replacement through safefile.editText (locked, atomic, backed up); the rest of the file is byte-for-byte unchanged.
//  - ~/.claude/plugins/synced/<org>/usage-max (old uploaded folders found by dupes.oldSyncedCopies) that are strictly older are MOVED, never deleted, to
//    ~/.usage-max/old-copies/<timestamp>/<name>, with a RESTORE.txt saying where each came from.
// Never touched: the running copy, a copy that is the same or newer, a copy whose version cannot be read, any other plugin (the name must be exactly "usage-max").
// Read-only unless fix is true. Running it again finds nothing.
import fs from "node:fs";
import path from "node:path";
import { oldSyncedCopies } from "./dupes.mjs";
import { editText, readText, writeAtomic } from "./safefile.mjs";

const SEMVER = /^\d+\.\d+\.\d+$/;
// -1/0/1, or null when either side is not a plain x.y.z (then nothing is provable and nothing is touched)
export function cmpVersion(a, b) {
  if (!SEMVER.test(String(a)) || !SEMVER.test(String(b))) return null;
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return e && null; } };
const inside = (child, parent) => { const r = path.relative(path.resolve(parent), path.resolve(child)); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
const stampDir = (d = new Date()) => d.toISOString().replace(/[:.]/g, "-");

// The settings key the running copy answers to (never disabled).
function runningKey(root) {
  const parts = path.resolve(root).split(path.sep);
  const i = parts.lastIndexOf("synced"); if (i > 0 && parts[i - 1] === "plugins") return "usage-max@synced";
  const c = parts.lastIndexOf("cache"); if (c > 0 && parts[c - 1] === "plugins" && parts[c + 2] === "usage-max") return `usage-max@${parts[c + 1]}`;
  return null;
}

// -> { version, folders: [{ dir, version, org }], keys: [settings key] } : everything provably older than the running copy.
export function planClaude({ home, root }) {
  const plan = { version: null, folders: [], keys: [] };
  const mine = (readJson(path.join(root, ".claude-plugin", "plugin.json")) || {}).version;
  if (!SEMVER.test(String(mine))) return plan;
  plan.version = mine;
  const synced = path.join(home, ".claude", "plugins", "synced"), older = (v) => cmpVersion(v, mine) === -1;
  const copies = oldSyncedCopies(home, root);
  for (const c of copies) {
    let st = null; try { st = fs.lstatSync(c.dir); } catch (e) { st = e && null; }
    if (!st || !st.isDirectory() || st.isSymbolicLink()) continue; // a link or a missing folder is not ours to move
    if (!older(c.version) || !inside(c.dir, synced) || inside(root, c.dir) || path.resolve(c.dir) === path.resolve(root)) continue;
    plan.folders.push({ dir: c.dir, version: c.version, org: path.basename(path.dirname(c.dir)) });
  }
  let st = null; try { st = JSON.parse(readText(path.join(home, ".claude", "settings.json")) || "null"); } catch (e) { st = e && null; }
  const ep = st && typeof st === "object" && st.enabledPlugins && typeof st.enabledPlugins === "object" ? st.enabledPlugins : {};
  const inst = readJson(path.join(home, ".claude", "plugins", "installed_plugins.json")) || {}, table = inst.plugins || inst, mineKey = runningKey(root);
  for (const [key, val] of Object.entries(ep)) {
    if (val === false || key.split("@")[0] !== "usage-max" || key === mineKey) continue;
    if (key === "usage-max@synced") { if (copies.length && copies.every((c) => older(c.version))) plan.keys.push(key); continue; }
    const ents = Array.isArray(table[key]) ? table[key] : table[key] ? [table[key]] : [];
    if (ents.length && ents.every((e) => e && older(e.version) && e.installPath && path.resolve(e.installPath) !== path.resolve(root) && !inside(root, e.installPath))) plan.keys.push(key);
  }
  return plan;
}

// "key": true  ->  "key": false for exactly the given keys, or null (leave alone) if the result is not the same JSON with only those values flipped.
export function disableKeys(text, keys) {
  let orig; try { orig = JSON.parse(text); } catch (e) { return e && null; }
  const want = JSON.parse(text); let next = text;
  for (const k of keys) {
    if (!want.enabledPlugins || want.enabledPlugins[k] === undefined || want.enabledPlugins[k] === false) continue;
    want.enabledPlugins[k] = false;
    const re = new RegExp(`("${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*)true\\b`);
    next = next.replace(re, "$1false");
  }
  let got; try { got = JSON.parse(next); } catch (e) { return e && null; }
  return orig && JSON.stringify(got) === JSON.stringify(want) && next !== text ? next : null;
}

function moveFolder(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.renameSync(src, dest); return; } catch (e) { if (!e || e.code !== "EXDEV") throw e; }
  fs.cpSync(src, dest, { recursive: true, errorOnExist: true, force: false }); // another drive: copy first, remove the original only when the copy is complete
  if (!fs.existsSync(path.join(dest, ".claude-plugin", "plugin.json"))) throw new Error("copy incomplete; original kept");
  fs.rmSync(src, { recursive: true, force: true });
}

// -> { found, done, lines: [plain text lines, doctor style] }
export function cleanupClaude({ home, root, fix = false, now = new Date() }) {
  const plan = planClaude({ home, root }), found = plan.folders.length + plan.keys.length, lines = [], res = { found, done: 0, lines };
  if (!found) { if (fix) lines.push("  ok   nothing to clean up in Claude Code"); return res; }
  if (!fix) {
    for (const f of plan.folders) lines.push(`  FIX  old uploaded copy usage-max ${f.version} (${f.dir}) can be moved aside for you\n       -> run: usage-max doctor --fix`);
    for (const k of plan.keys) lines.push(`  FIX  settings.json still enables an older ${k}\n       -> run: usage-max doctor --fix`);
    return res;
  }
  if (plan.keys.length) {
    const sf = path.join(home, ".claude", "settings.json");
    const r = editText(sf, (t) => disableKeys(t, plan.keys));
    if (r.error) lines.push(`  FIX  could not update settings.json: ${r.error}`);
    else if (r.changed) { res.done += plan.keys.length; lines.push(`  done disabled ${plan.keys.length} older usage-max plugin entr${plan.keys.length === 1 ? "y" : "ies"} in settings.json (${plan.keys.join(", ")}); backup at ${r.backup}`); }
  }
  const batch = path.join(home, ".usage-max", "old-copies", stampDir(now)), restore = [];
  for (const f of plan.folders) {
    let dest = path.join(batch, `${f.org}-usage-max-${f.version}`); for (let i = 2; fs.existsSync(dest); i++) dest = path.join(batch, `${f.org}-usage-max-${f.version}-${i}`);
    try { moveFolder(f.dir, dest); res.done++; restore.push(`${dest}  <-  ${f.dir}`); lines.push(`  done moved old copy ${f.version} to ${dest}   (to undo, move it back to ${f.dir})`); }
    catch (e) { lines.push(`  FIX  could not move old copy ${f.version} (${f.dir}): ${e.code || e.message}; left as it was (is Claude using it right now? close Claude and run doctor --fix again)`); }
  }
  if (restore.length) { try { writeAtomic(path.join(batch, "RESTORE.txt"), "usage-max doctor --fix moved these old copies here. To undo, move a folder back to where it came from:\n" + restore.join("\n") + "\n"); } catch (e) { lines.push(`  note could not write RESTORE.txt (${e.code || e.message}); the moves are listed above`); } }
  if (!res.done && !lines.length) lines.push("  ok   nothing to clean up in Claude Code");
  return res;
}
