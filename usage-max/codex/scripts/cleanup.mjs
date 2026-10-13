// `codex doctor --fix`: remove the leftover plugin / hook-trust entries of an OLD uploaded copy of usage-max from Codex's config.toml.
// Only entries the doctor already calls stale are removed: Claude-only hook trust ([hooks.state."usage-max@<upload|synced|local name>:hooks/hooks.json:..."]),
// and the [plugins."usage-max@<same name>"] table of such a copy when no Codex-specific (codex/hooks.json) trust remains for that name.
// Everything else (other plugins, comments, CRLF, the marketplace install, hooks.json) is left byte-for-byte. The edit goes through
// safefile.editText: locked, atomic, backed up first. Running it again finds nothing and changes nothing.
import path from "node:path";
import { editText, readText } from "./safefile.mjs";
import { valueEnd } from "./toml.mjs";

// dotted key at s[pos..] -> { segs, pos } (pos = first char after the key, whitespace skipped) or null
function parseKey(s, pos = 0) {
  const segs = []; let p = pos;
  for (;;) {
    while (s[p] === " " || s[p] === "\t") p++;
    let seg;
    if (s[p] === '"') { let q = p + 1; while (q < s.length && s[q] !== '"') q += s[q] === "\\" ? 2 : 1; if (q >= s.length) return null; try { seg = JSON.parse(s.slice(p, q + 1)); } catch (e) { return null; } p = q + 1; }
    else if (s[p] === "'") { const q = s.indexOf("'", p + 1); if (q < 0) return null; seg = s.slice(p + 1, q); p = q + 1; }
    else { const m = /^[A-Za-z0-9_-]+/.exec(s.slice(p)); if (!m) return null; seg = m[0]; p += seg.length; }
    segs.push(seg);
    while (s[p] === " " || s[p] === "\t") p++;
    if (s[p] === ".") { p++; continue; }
    return { segs, pos: p };
  }
}
const STATE_RE = /^usage-max@([\w.-]+):(codex\/hooks\.json|hooks\/hooks\.json):/;
function classify(segs) {
  if (segs[0] === "plugins" && typeof segs[1] === "string") { const m = /^usage-max@([\w.-]+)$/.exec(segs[1]); if (m) return { kind: "plugin", name: m[1] }; }
  if (segs[0] === "hooks" && segs[1] === "state" && typeof segs[2] === "string") { const m = STATE_RE.exec(segs[2]); if (m) return { kind: "state", name: m[1], claudeOnly: m[2] === "hooks/hooks.json" }; }
  return null;
}
const OLD_NAME = /synced|upload|local/i; // the same name rule the doctor uses

// -> { next, removed: [{ what, lines }], names: [...] }; next === text when there is nothing to remove
export function removeLeftovers(text) {
  const lines = String(text).split("\n"), n = lines.length, items = []; // items: { start, end, segs, table }
  let cur = null, i = 0;
  const close = (endExcl) => { if (cur) { cur.end = endExcl - 1; items.push(cur); cur = null; } };
  while (i < n) {
    const ln = lines[i].replace(/\r$/, "");
    if (/^\s*\[/.test(ln)) {
      close(i);
      const dbl = /^\s*\[\[/.test(ln), k = parseKey(ln, ln.indexOf("[") + (dbl ? 2 : 1));
      cur = { start: i, segs: k && ln.slice(k.pos).trimStart().startsWith("]") ? k.segs : [], table: true }; i++; continue;
    }
    if (!cur || !cur.table) { // top-level dotted keys (before the first table header)
      const k = parseKey(ln, 0);
      if (k && ln[k.pos] === "=") { const end = valueEnd(lines, i, ln.slice(k.pos + 1).replace(/^\s*/, "")); if (k.segs.length > 1) items.push({ start: i, end, segs: k.segs, table: false }); i = end + 1; continue; }
      i++; continue;
    }
    const k = parseKey(ln, 0); // inside a table: skip multi-line values so their lines are not mistaken for headers
    if (k && ln[k.pos] === "=") { i = valueEnd(lines, i, ln.slice(k.pos + 1).replace(/^\s*/, "")) + 1; continue; }
    i++;
  }
  close(n);
  const cls = items.map((it) => ({ it, c: classify(it.segs) })).filter((x) => x.c);
  const codexTrust = new Set(cls.filter((x) => x.c.kind === "state" && !x.c.claudeOnly).map((x) => x.c.name));
  const oldNames = new Set(cls.filter((x) => x.c.kind === "state" && x.c.claudeOnly && OLD_NAME.test(x.c.name)).map((x) => x.c.name));
  const drop = cls.filter((x) => oldNames.has(x.c.name) && (x.c.kind === "state" ? x.c.claudeOnly : !codexTrust.has(x.c.name)));
  if (!drop.length) return { next: String(text), removed: [], names: [] };
  const kill = new Array(n).fill(false);
  for (const { it } of drop) {
    let e = it.end;
    if (it.table) while (e > it.start && (lines[e].trim() === "" || /^\s*#/.test(lines[e]))) e--; // a trailing blank or comment belongs to what follows
    let s = it.start;
    for (let x = s; x <= e; x++) kill[x] = true;
    if (s === 0 || lines[s - 1].trim() === "") { // a blank line already separates it from what is above: take the blank lines below too, so one table never leaves two
      let f = e + 1; while (f < n - 1 && lines[f].trim() === "") f++;
      for (let x = e + 1; x < f; x++) kill[x] = true;
      if (f >= n - 1) while (s > 0 && lines[s - 1].trim() === "") { s--; kill[s] = true; } // nothing follows: no stray blank lines at the end of the file
    }
  }
  const next = lines.filter((_, x) => !kill[x]).join("\n");
  return { next, removed: drop.map(({ it, c }) => ({ what: `${c.kind === "plugin" ? "plugin" : "hook trust"} usage-max@${c.name}`, lines: it.end - it.start + 1 })), names: [...oldNames] };
}

// codexHome/config.toml. fix=false: read only. -> { found, removed, names, backup?, error? }
export function cleanupCodex({ codexHome, fix = false } = {}) {
  const f = path.join(codexHome, "config.toml"), out = { found: 0, removed: 0, names: [] };
  let t; try { t = readText(f); } catch (e) { out.error = `could not read config.toml (${e.code || e.message})`; return out; }
  if (t === null) return out; // no config.toml: nothing to clean, and nothing (not even its folder) is created
  const first = removeLeftovers(t); out.found = first.removed.length; out.names = first.names;
  if (!fix || !first.removed.length) return out;
  out.found = 0; out.names = [];
  let found = null;
  const r = editText(f, (t) => { if (!t) return null; found = removeLeftovers(t); return found.removed.length ? found.next : null; });
  if (r.error) { out.error = r.error; return out; }
  if (r.changed && found) { out.found = out.removed = found.removed.length; out.names = found.names; out.backup = r.backup; }
  return out;
}

// Plain doctor-style lines for a cleanupCodex result ("" when there is nothing to say in a read-only run).
export function cleanupLines(r, fix) {
  if (r.error) return `\n  FIX  could not clean up the Codex config: ${r.error}`;
  const who = r.names.map((n) => `usage-max@${n}`).join(", ");
  if (fix) return r.removed ? `\n  done removed ${r.removed} leftover Codex entr${r.removed === 1 ? "y" : "ies"} of an old usage-max copy (${who}); backup at ${r.backup || "(none: file was new)"}` : "\n  ok   nothing to clean up in Codex";
  return r.found ? `\n  FIX  ${r.found} leftover Codex entr${r.found === 1 ? "y" : "ies"} of an old usage-max copy (${who}) can be removed for you\n       -> run: usage-max doctor --fix   (or: usage-max codex doctor --fix)` : "";
}
