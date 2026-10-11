// Codex-side guards (PreToolUse Bash). Pure + fail-open. POSIX shells only: on win32 they do nothing (unverified shell quoting).
//   loop:    the 3rd identical command in a row gets a note appended to its output (the model sees it; the exit code is preserved)
//   big cat: a bare `cat <file>` of a big file prints the first 200 lines plus a note to read ranges (sed -n A,Bp) or search (rg)
// Off: USAGE_MAX_GUARDS=off or config.json guards:"off". Counts (never commands) go to <dataDir>/guard-stats.json.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const wj = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + "." + process.pid + ".tmp"; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); } catch {} };
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
export const BIG_BYTES = 40000, HEAD_LINES = 200;
function stat(dir, name) { const f = path.join(dir, "guard-stats.json"), s = rj(f, {}); s[name] = (s[name] || 0) + 1; wj(f, s); }
export function loopNote(dir, sid, cmd, { n = 3 } = {}) {
  if (typeof cmd !== "string" || cmd.trim().length < 8) return null;
  const f = path.join(dir, "guard-loop.json"), all = rj(f, {}), h = crypto.createHash("sha1").update(cmd.trim()).digest("hex").slice(0, 10), s = all[sid] || { h: null, c: 0 };
  s.c = s.h === h ? s.c + 1 : 1; s.h = h; all[sid] = s; const keys = Object.keys(all); if (keys.length > 50) for (const k of keys.slice(0, keys.length - 30)) delete all[k]; wj(f, all);
  if (s.c < n) return null; stat(dir, "loopNotes");
  return `[usage-max: this exact command has now run ${s.c} times in a row. If the result is not changing, stop and change something (read the error, try another approach, ask the user) instead of running it again.]`;
}
export function bigCat(cmd, cwd, platform = process.platform) {
  if (platform === "win32" || typeof cmd !== "string") return null;
  const m = cmd.trim().match(/^cat\s+([\w@+=:,./-]+)$/); if (!m) return null;
  const p = path.resolve(cwd || process.cwd(), m[1]); let st; try { st = fs.statSync(p); } catch { return null; } if (!st.isFile() || st.size <= BIG_BYTES) return null;
  const kb = Math.round(st.size / 1024);
  return { command: `sed -n '1,${HEAD_LINES}p' ${q(p)}; echo ${q(`[usage-max: ${m[1]} is ${kb} KB, so only the first ${HEAD_LINES} lines are shown. Read a range with: sed -n 'A,Bp' ${m[1]}  or search with: rg -n PATTERN ${m[1]}]`)}`, kb };
}
// -> new command string or null
export function guard(dir, sid, cmd, cwd, platform = process.platform, env = process.env) {
  if (platform === "win32" || env.USAGE_MAX_GUARDS === "off" || rj(path.join(dir, "config.json"), {}).guards === "off") return null;
  const big = bigCat(cmd, cwd, platform); if (big) { stat(dir, "bigCats"); return big.command; }
  const note = loopNote(dir, sid, cmd); if (note && !/\n/.test(cmd)) return `( ${cmd.trim()} ); rc=$?; echo ${q(note)}; exit $rc`;
  return null;
}
export const stats = (dir) => rj(path.join(dir, "guard-stats.json"), {});
