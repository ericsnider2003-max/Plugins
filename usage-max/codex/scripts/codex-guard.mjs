// Codex-side guards for the Bash tool (Codex hooks only see Bash, not apply_patch/edits): runaway repeats and huge whole-file dumps.
// Self-contained (state is one small JSON per session). Never throws; every function returns null when it has nothing to say.
// Output shape is the same hookSpecificOutput the Claude side uses; if a Codex build ignores it, nothing breaks, you just lose the hint.
import fs from "node:fs"; import path from "node:path";

const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const sf = (dir, sid) => path.join(dir, "guard", `${String(sid || "x").replace(/[^\w.-]/g, "_").slice(0, 80)}.json`);
function save(dir, sid, s) { try { fs.mkdirSync(path.join(dir, "guard"), { recursive: true }); fs.writeFileSync(sf(dir, sid), JSON.stringify(s)); if (Math.random() < 0.05) for (const n of fs.readdirSync(path.join(dir, "guard"))) { const p = path.join(dir, "guard", n); try { if (Date.now() - fs.statSync(p).mtimeMs > 3 * 864e5) fs.unlinkSync(p); } catch {} } } catch {} }
const hash = (c) => { let h = 2166136261; for (const ch of String(c).trim().replace(/\s+/g, " ").slice(0, 400)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const MUTATES = /\bapply_patch\b|\bsed\s+-i\b|\bgit\s+(commit|checkout|restore|stash|reset|apply)\b|(^|[^>])>{1,2}\s*\S|\btee\b|\bmv\b|\bcp\b/;
const bump = (dir, name) => { try { const f = path.join(dir, "guard-events.json"); const e = rj(f, { counts: {} }); e.counts[name] = (e.counts[name] || 0) + 1; fs.writeFileSync(f, JSON.stringify(e)); } catch {} };

// Edits happen through apply_patch, which these hooks do not see, so a legitimate "fix, re-run the tests" cycle looks like a repeat.
// Hence the high thresholds: 5th identical command in the recent window = hint, 9th = stop.
export function loopCheck(dir, sid, cmd, { warn = 5, stop = 9 } = {}) {
  if (typeof cmd !== "string" || !cmd.trim()) return null;
  const s = rj(sf(dir, sid), { hashes: [], warned: {} });
  if (MUTATES.test(cmd)) s.hashes = []; else s.hashes = [...(s.hashes || []), hash(cmd)].slice(-40);
  const h = hash(cmd), same = s.hashes.filter((x) => x === h).length; const lvl = same >= stop ? 2 : same >= warn ? 1 : 0; let out = null;
  if (lvl && (s.warned[h] || 0) < lvl) {
    s.warned[h] = lvl; bump(dir, "loopWarnings");
    out = lvl === 1 ? `usage-max: this exact command has now run ${same} times. Re-running it will not change the result; read the failure, change something, or try a different check first.`
      : `usage-max: this exact command has run ${same} times: it looks like a loop burning the user's plan. Stop, summarise what you tried and what you think is wrong, and ask the user how to proceed.`;
  }
  save(dir, sid, s); return out;
}
// `cat big.log` / `cat a b` style dumps of files over ~400 KB (about 100k tokens). Returns a reason string once per file; the retry goes through.
export function bigDump(dir, sid, cmd, cwd = process.cwd(), { bytes = 400000 } = {}) {
  const m = typeof cmd === "string" && cmd.trim().match(/^cat\s+([^|&;<>$`()*?\n]+)$/); if (!m) return null;
  const s = rj(sf(dir, sid), { hashes: [], warned: {} }); s.blocked = s.blocked || {};
  for (const raw of m[1].trim().split(/\s+/)) {
    if (raw.startsWith("-")) continue; const p = path.resolve(cwd, raw.replace(/^["']|["']$/g, "")); let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isFile() && st.size > bytes && !s.blocked[p]) {
      s.blocked[p] = Date.now(); save(dir, sid, s); bump(dir, "bigReadsHeld");
      return `usage-max: ${path.basename(p)} is ${Math.round(st.size / 1000)} KB (about ${Math.round(st.size / 4000)}k tokens); dumping it all would sit in the context for every following turn. Use rg for what you need, or sed -n 'START,ENDp' for a range. If you really need all of it, run the same command again.`;
    }
  }
  return null;
}
