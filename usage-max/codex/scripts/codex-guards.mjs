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
// A command that changes files is progress (the next identical run can give a different answer); status/polling commands are expected to repeat.
const MUTATES = /\bsed\s+(-[a-z]*i|--in-place)|\bgit\s+(apply|checkout|restore|stash|commit|merge|rebase|reset|cherry-pick|pull)\b|\bpatch\b|\btee\b|\b(mv|cp|rm|touch|mkdir)\b|\b(npm|pnpm|yarn)\s+(install|i|add|remove|update)\b|\bpip3?\s+install\b|(^|[^>0-9&])>{1,2}\s*[^\s&]/;
const POLLING_CMD = /^\s*(gh\s+(run|pr|workflow|api|issue)\b|git\s+(status|fetch|log|diff|ls-remote)\b|kubectl\s+(get|describe|logs|rollout)\b|docker\s+(ps|logs|inspect)\b|systemctl\s+(status|is-active)\b|sleep\b|tail\b|curl\b|ls\b|pgrep\b|ps\b)/;
export function loopNote(dir, sid, cmd, { n = 3 } = {}) {
  if (typeof cmd !== "string" || cmd.trim().length < 8) return null;
  if (POLLING_CMD.test(cmd)) return null;
  const f = path.join(dir, "guard-loop.json"), all = rj(f, {}), h = crypto.createHash("sha1").update(cmd.trim()).digest("hex").slice(0, 10), s = all[sid] || { h: null, c: 0 };
  s.c = s.h === h && !MUTATES.test(cmd) ? s.c + 1 : 1; s.h = h; all[sid] = s; const keys = Object.keys(all); if (keys.length > 50) for (const k of keys.slice(0, keys.length - 30)) delete all[k]; wj(f, all);
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

// ---- long-session nudge: the context a session carries is re-read on EVERY call, which is most of the plan use for long sessions.
// sessionContext: tokens in the most recent call of this session's rollout file (found by session id; with no id at all, the file written in the last 2 minutes).
function* rollouts(root) { let es; try { es = fs.readdirSync(root, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(root, e.name); if (e.isDirectory()) yield* rollouts(f); else if (e.name.endsWith(".jsonl")) yield f; } }
export function sessionContext(codexHome, sid, now = Date.now()) {
  let file = null, newest = null, newestM = 0;
  for (const f of rollouts(path.join(codexHome, "sessions"))) { if (sid && sid !== "?" && path.basename(f).includes(sid)) { file = f; break; } try { const m = fs.statSync(f).mtimeMs; if (m > newestM) { newestM = m; newest = f; } } catch {} }
  if (!file && (!sid || sid === "?") && newest && now - newestM < 120e3) file = newest; // guess only when the hook gave no session id; never attribute another session's context
  if (!file) return null;
  let text; try { const st = fs.statSync(file), len = Math.min(st.size, 200000), fd = fs.openSync(file, "r"), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); text = buf.toString("utf8"); } catch { return null; }
  const lines = text.split("\n"); for (let i = lines.length - 1; i >= 0; i--) { if (!lines[i].includes("token_count")) continue; try { const o = JSON.parse(lines[i]); const p = o.payload || o; const u = (p.info || p).last_token_usage; if (u && u.input_tokens) return u.input_tokens; } catch {} }
  return null;
}
export const NUDGE_AT = 120000;
// Tighter when the plan is running low: the same long session costs more of what is left.
export const nudgeAt = (mode) => (mode === "red" ? 60000 : mode === "amber" ? 90000 : NUDGE_AT);
export function nudge(ctx, at = NUDGE_AT) {
  if (!ctx || ctx < at) return null; const level = ctx >= at + 80000 ? 2 : 1, k = Math.round(ctx / 1000);
  return { level, text: level === 1
    ? `usage-max: this session now carries about ${k}k tokens and re-reads all of it on EVERY call, which is most of the plan use. When this task reaches a good stopping point, tell the user in one sentence that a fresh session (/new, with a 5-line summary of where things stand) will cost several times less per step.`
    : `usage-max: this session carries about ${k}k tokens per call, far past the point where continuing pays. Tell the user now, in one sentence, to start a fresh session (/new) with a short summary: every further step here costs several times more than it would there.` };
}
