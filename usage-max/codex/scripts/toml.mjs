// Minimal, careful editing of TOP-LEVEL keys in a user's config.toml. Everything else in the file is left byte-for-byte alone.
// Understands: "quoted" and 'quoted' keys, values that span lines (arrays, inline tables, """ / ''' strings), # comments, CRLF files, and
// that a line starting with [ inside a multi-line array is NOT a table header. Dependency-free.

// Where does the value that starts at lines[i] (text after the "=") end? -> index of its last line.
function valueEnd(lines, i, rest) {
  let depth = 0, multi = null, line = i, s = rest;
  for (;;) {
    for (let p = 0; p < s.length; p++) {
      const c = s[p];
      if (multi) { if (s.startsWith(multi, p)) { multi = null; p += 2; } else if (multi === '"""' && c === "\\") p++; continue; }
      if (c === "#") break;
      if (s.startsWith('"""', p) || s.startsWith("'''", p)) { multi = s.slice(p, p + 3); p += 2; continue; }
      if (c === '"') { for (p++; p < s.length && s[p] !== '"'; p++) if (s[p] === "\\") p++; continue; }
      if (c === "'") { for (p++; p < s.length && s[p] !== "'"; p++); continue; }
      if (c === "[" || c === "{") depth++; else if (c === "]" || c === "}") depth--;
    }
    if (depth <= 0 && !multi) return line;
    if (++line >= lines.length) return lines.length - 1; // unterminated: take the rest, never run past the file
    s = lines[line].replace(/\r$/, "");
  }
}
export function scanTop(toml) {
  const lines = String(toml).split("\n"), entries = []; let i = 0;
  while (i < lines.length) {
    const ln = lines[i].replace(/\r$/, "");
    if (/^\s*\[/.test(ln)) break; // first table / array-of-tables header
    const m = ln.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*))\s*=\s*(.*)$/);
    if (!m) { i++; continue; }
    const end = valueEnd(lines, i, m[4]);
    entries.push({ key: m[1] ?? m[2] ?? m[3], start: i, end, rest: m[4] }); i = end + 1;
  }
  return { lines, entries, firstTable: i };
}
// The raw text of a top-level value (trailing comment removed for a one-line value), or undefined.
export function topValue(toml, key) {
  const { lines, entries } = scanTop(toml), e = entries.find((x) => x.key === key); if (!e) return undefined;
  const txt = e.start === e.end ? e.rest : [e.rest, ...lines.slice(e.start + 1, e.end + 1).map((l) => l.replace(/\r$/, ""))].join("\n");
  return e.start === e.end ? txt.replace(/\s+#.*$/, "").trim() : txt.trim();
}
const fmt = (v) => v === null ? null : v && typeof v === "object" && "raw" in v ? String(v.raw) : typeof v === "number" ? String(v) : JSON.stringify(v);
// kv value: string | number | { raw } (already-TOML text) | null (remove the key). Existing keys are replaced in place, new ones go above the first table.
export function setTopLevel(toml, kv) {
  const eol = String(toml).includes("\r\n") ? "\r\n" : "\n"; let text = String(toml);
  for (const [k, v] of Object.entries(kv)) {
    const val = fmt(v), { lines, entries, firstTable } = scanTop(text), e = entries.find((x) => x.key === k);
    if (val === null) { if (e) lines.splice(e.start, e.end - e.start + 1); }
    else if (e) lines.splice(e.start, e.end - e.start + 1, `${k} = ${val}${eol === "\r\n" ? "\r" : ""}`);
    else lines.splice(firstTable, 0, `${k} = ${val}${eol === "\r\n" ? "\r" : ""}`);
    text = lines.join("\n");
  }
  return text;
}
