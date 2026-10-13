// `usage-max memory suggestions`: durable-note candidates from the session log (what you asked in past sessions). A deterministic cue-phrase
// scan, no model, no network. It lists one line per candidate (index first); NOTHING is saved to project memory unless you pass --accept,
// and --dismiss hides a line for good. State lives outside the repo, in <home>/.usage-max/memory-suggestions/ (not in memory-state/, which is pruned by age).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addFact, decide, listTopics, looksPersonal, readDecisions, tokens } from "./memory.mjs";
import { canonPath, writeAtomic } from "./safefile.mjs";
import { homeOf, logFileFor, projectRoot, readLog, MAX_AGE_MS } from "./sessionlog.mjs";

export const MAX_CANDIDATES = 8, MAX_LINE = 140, MAX_REMEMBERED = 2000;
const ignore = (e) => e;
// [pattern, strength, rule-like?]. Rule-like lines become decisions; the others go to the topic "session-notes".
const CUES = [
  [/\b(?:we decided|we(?:'|’)ve decided|we have decided)\b/i, 3, true], [/\bthe rule is\b/i, 3, true], [/\bmake sure to always\b/i, 3, true],
  [/\bgoing forward\b/i, 3, true], [/\b(?:don(?:'|’)t|do not) ever\b/i, 3, true], [/\bremember that\b/i, 3, false],
  [/\blet(?:'|’)?s use\b/i, 2, false], [/\bwe(?: are|(?:'|’)re) using\b/i, 2, false], [/\binstead of\b/i, 2, false],
  [/\bnever\b(?!\s+mind)/i, 1, true], [/\balways\b/i, 1, true]
];
const FILLER = /^(?:ok(?:ay)?|also|and|so|btw|then|please|well|yes|yeah|right|now)\b[\s,.:;-]*/i;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hashOf = (text) => crypto.createHash("sha1").update(norm(text)).digest("hex").slice(0, 12);
const dayOf = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return "unknown"; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const stateFile = (root, env = process.env) => path.join(homeOf(env), ".usage-max", "memory-suggestions", `${crypto.createHash("sha1").update(canonPath(root)).digest("hex").slice(0, 12)}.json`);
export function loadState(root, env) { try { const o = JSON.parse(fs.readFileSync(stateFile(root, env), "utf8")); return { dismissed: [], saved: [], list: [], announced: "", ...o }; } catch (e) { ignore(e); return { dismissed: [], saved: [], list: [], announced: "" }; } }
export function saveState(root, st, env) {
  const f = stateFile(root, env); st.dismissed = (st.dismissed || []).slice(-MAX_REMEMBERED); st.saved = (st.saved || []).slice(-MAX_REMEMBERED);
  try { writeAtomic(f, JSON.stringify(st), { mode: 0o600 }); if (process.platform !== "win32") fs.chmodSync(path.dirname(f), 0o700); return true; } catch (e) { ignore(e); return false; }
}

// the one sentence of a request that carries the cue, <= 140 chars, or null (a question, personal data, too short)
export function lineOf(text) {
  const t = String(text || "");
  if (looksPersonal(t) || /\[(?:redacted|email)\]/.test(t)) return null; // personal data or a secret was in it: never offered
  for (const raw of t.split(/(?<=[.!?])\s+/)) {
    let s = raw.trim().replace(FILLER, "").replace(FILLER, "").trim(); if (!s || s.endsWith("?")) continue;
    let best = null; for (const [re, strength, rule] of CUES) if (re.test(s) && (!best || strength > best.strength)) best = { strength, rule };
    if (!best || s.length < 15) continue;
    if (s.length > MAX_LINE) { const cut = s.slice(0, MAX_LINE - 2); s = cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX_LINE - 30)).replace(/[\s,;:(\-]+$/, "") + " …"; }
    return { text: s, ...best };
  }
  return null;
}
const similar = (a, b) => { const ta = tokens(a); if (ta.length < 3) return false; const tb = new Set(tokens(b)); return ta.filter((w) => tb.has(w)).length / ta.length >= 0.8; };
function existingLines(mem) {
  if (!mem) return [];
  const out = []; try { for (const d of readDecisions(mem)) out.push(`${d.key} ${d.value}`); } catch (e) { ignore(e); }
  try { for (const t of listTopics(mem)) for (const l of t.text.split(/\r?\n/)) if (l.trim().length > 12) out.push(l); } catch (e) { ignore(e); }
  return out;
}

// candidates not yet saved, dismissed or already in .memory, strongest cue first, then newest. Pure read.
export function candidates(root, { mem = null, env = process.env, now = Date.now(), max = MAX_CANDIDATES } = {}) {
  const st = loadState(root, env), gone = new Set([...st.dismissed, ...st.saved]);
  const have = existingLines(mem).map((l) => ({ n: norm(l), raw: l }));
  const found = [];
  for (const e of readLog(logFileFor(root, env))) {
    if (e.type !== "user") continue; const when = Date.parse(e.time); if (!Number.isNaN(when) && now - when > MAX_AGE_MS) continue;
    const c = lineOf(e.text); if (!c) continue;
    found.push({ ...c, time: Number.isNaN(when) ? 0 : when, date: dayOf(e.time), hash: hashOf(c.text) });
  }
  found.sort((a, b) => b.strength - a.strength || b.time - a.time);
  const out = [];
  for (const c of found) {
    if (gone.has(c.hash) || out.some((o) => o.hash === c.hash || similar(c.text, o.text))) continue;
    const n = norm(c.text); if (have.some((h) => h.n.includes(n) || (h.n.length >= 20 && n.includes(h.n)) || similar(c.text, h.raw))) continue;
    out.push(c); if (out.length >= max) break;
  }
  return out;
}
const keyOf = (c) => "rule-" + norm(c.text).split(" ").slice(0, 5).join("-").slice(0, 40) + "-" + c.hash.slice(0, 4);
const valueOf = (c) => `${c.text} (from a session on ${c.date})`;

// SessionStart: one short line, at most once per candidate set, only when something is waiting. -> string | null (never longer than 220 chars)
export function announce(root, { mem, scriptsDir, env = process.env } = {}) {
  if (!mem) return null;
  const list = candidates(root, { mem, env }); if (!list.length) return null;
  const st = loadState(root, env), setKey = crypto.createHash("sha1").update(list.map((c) => c.hash).sort().join(",")).digest("hex").slice(0, 12);
  if (st.announced === setKey) return null;
  const cmd = `node "${path.join(scriptsDir, "memory-cli.mjs")}" suggestions`, n = list.length, what = `${n} possible project note${n === 1 ? "" : "s"}`;
  const tiers = [
    `usage-max: ${what} from your last sessions. Say "show memory suggestions" to review; nothing is saved unless you approve. Run: ${cmd}`,
    `usage-max: ${what}. For "show memory suggestions" run: ${cmd}  (nothing saved without approval)`,
    `usage-max: ${what}. "show memory suggestions" = run: ${cmd}`
  ];
  const line = tiers.find((t) => t.length <= 220); if (!line) return null;
  st.announced = setKey; if (!saveState(root, st, env)) return null; // if it cannot be remembered, say nothing rather than repeat it every session
  return line;
}

export function render(list) {
  if (!list.length) return "no suggestions: nothing in your recent requests reads like a decision, preference or rule that is not already noted. (To look for something specific: usage-max memory search <words>)";
  return list.map((c) => `${String(c.id).padStart(2)}. [${c.date}] ${c.text}`).join("\n")
    + "\n\nNothing has been saved. Save the true ones: usage-max memory suggestions --accept 1,3   (or --accept all). Hide ones you do not want: --dismiss 2,4 (or --dismiss all); they never come back.";
}
function pickIds(arg, list) {
  const open = list.filter((c) => !c.done);
  if (String(arg).trim().toLowerCase() === "all") return open.map((c) => c.id);
  return String(arg === true ? "" : arg).split(",").map((x) => parseInt(x, 10)).filter(Number.isFinite);
}

// The CLI body. a = args after the subcommand. -> exit code
export function cli(a, { cwd = process.cwd(), mem = null, env = process.env, out = console.log } = {}) {
  const root = projectRoot(cwd), st = loadState(root, env);
  const take = (n) => { const i = a.indexOf("--" + n); if (i < 0) return null; const v = a[i + 1]; return v && !v.startsWith("--") ? v : true; };
  const acc = take("accept"), dis = take("dismiss");
  if (acc === null && dis === null) {
    const list = candidates(root, { mem, env }).map((c, i) => ({ id: i + 1, ...c })); st.list = list; saveState(root, st, env);
    if (!fs.existsSync(logFileFor(root, env))) out("no session log for this project yet (it is written when a session ends).");
    out(render(list)); return 0;
  }
  if (!st.list.length) { out("no suggestion list yet. Run: usage-max memory suggestions"); return 1; }
  const ids = pickIds(acc !== null ? acc : dis, st.list);
  if (!ids.length) { out("usage: usage-max memory suggestions --accept 1,3 | all    or    --dismiss 2,4 | all"); return 1; }
  if (acc !== null && !mem) { out("no project memory here yet, so nothing can be saved. Create it first: usage-max memory init"); return 1; }
  let saved = 0, bad = 0;
  for (const id of ids) {
    const c = st.list.find((x) => x.id === id);
    if (!c) { out(`#${id}: no such suggestion (run usage-max memory suggestions again)`); bad++; continue; }
    if (c.done) { out(`#${id}: already handled`); continue; }
    if (acc !== null) {
      const r = c.rule ? decide(mem, keyOf(c), valueOf(c)) : addFact(mem, "session-notes", valueOf(c));
      if (r.error) { out(`NOT saved #${id}: ${r.error}`); bad++; continue; }
      st.saved.push(c.hash); c.done = "saved"; saved++; out(`saved #${id}: ${r.unchanged || r.duplicate ? "already there" : c.rule ? "decision " + keyOf(c) : "noted in session-notes"}`);
    } else { st.dismissed.push(c.hash); c.done = "dismissed"; out(`dismissed #${id}: it will not be suggested again`); }
  }
  saveState(root, st, env); return bad && !saved && acc !== null ? 1 : 0;
}
