// Deterministic per-job checks for local-model answers (used by offload.mjs). A failing answer is never returned.
// The checks catch format errors, changed code and invented names/numbers/paths; they cannot judge whether a summary is complete or well put.
const nl = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
const keepEdges = (job) => job === "docstrings" || /^convert:tsv$/i.test(job || ""); // indentation and edge tabs matter there
export function stripFence(s, job) {
  const l = nl(s).replace(/^\n+|\n+$/g, "").split("\n");
  if (l[0].trim().startsWith("```")) l.shift();
  if (l.length && l[l.length - 1].trim() === "```") l.pop();
  const r = l.join("\n").replace(/^\n+|\n+$/g, "");
  return keepEdges(job) ? r : r.trim();
}
const EXT = "js|mjs|cjs|ts|tsx|jsx|py|rs|go|md|json|ya?ml|toml|ps1|sh|css|html|java|c|h|cpp|cs|rb|php|sql|txt";
// a file path: dir/name.ext, ./x, ../x, or a bare name.ext (not "and/or", "I/O", dates, or product names such as Node.js)
const PATH = new RegExp(String.raw`(?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w-]+\.(?:${EXT})\b|\.{1,2}\/[\w./-]+`, "g");
const PRODUCT = /^[A-Z][a-z]*\.js$/;
const COMMON = new Set(["macOS", "iOS", "iPhone", "iPad", "eBay", "snake_case", "camelCase", "gRPC", "mTLS", "eBPF", "jQuery"]);
const JOBS_WITH_CHECK = ["commit", "docstrings", "summarize", "explain"], FORMATS = ["json", "csv", "tsv"];
export const hasCheck = (job) => JOBS_WITH_CHECK.includes(job) || (/^convert:/.test(job) && FORMATS.includes(job.slice(8).toLowerCase()));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inText = (tok, input) => new RegExp(`(^|[^\\w])${esc(tok)}($|[^\\w])`).test(input); // whole token: "12" is not found in "120"
const paths = (s) => (s.match(PATH) || []).filter((p) => !PRODUCT.test(p));
function missing(out, input) {
  const toks = [];
  for (const m of out.matchAll(/`([^`\n]+)`/g)) toks.push(m[1].trim());
  const plain = out.replace(/`[^`\n]*`/g, " ");
  toks.push(...(plain.match(/\b\d[\d.,:]*\d\b/g) || []).map((n) => n.replace(/[.,:]+$/, "")));
  toks.push(...(plain.match(/\b[A-Za-z_$][\w$]*\b/g) || []).filter((w) => !COMMON.has(w) && (w.includes("_") || /^[a-z]+[A-Z]/.test(w))));
  toks.push(...paths(plain));
  return toks.find((t) => t && (/^[\w$]+$/.test(t) ? !inText(t, input) : !input.includes(t)));
}
const grounded = (out, input) => { const t = missing(out, input); return t === undefined ? "" : `"${t}" is not in the input`; };

// docstrings: every original line must come back unchanged and in order; the only additions allowed are comment lines and blank lines.
// A comment line: "// x", "# x" (not #define/#priv), " * x" (not *p = 0), "-- x" (not --i), "/* x", "*/", HTML comments.
const COMMENT = /^\s*(\/\/|#(\s|#|!|$)|\/\*|\*(\s|\/|$)|--(\s|$)|<!--|-->)/;
const TRAIL = /^\s+(\/\/|#)\s/; // an inline comment appended to an unchanged code line
const lines = (s) => nl(s).split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => !/^### /.test(l)); // offload adds "### <file>" headers
function docstrings(input, out) {
  const a = lines(input), b = lines(out); let i = 0, added = 0, block = null;
  for (const l of b) {
    if (block) { added++; if (l.includes(block)) { if (l.slice(l.indexOf(block) + block.length).trim()) return "the code itself was changed"; block = null; } continue; }
    if (i < a.length && l === a[i]) { i++; continue; }
    if (!l.trim()) continue;
    while (i < a.length && !a[i].trim()) i++; // dropped blank lines are fine
    if (i < a.length && l === a[i]) { i++; continue; }
    if (i < a.length && a[i].trim() && l.startsWith(a[i]) && TRAIL.test(l.slice(a[i].length))) { i++; added++; continue; }
    const t = l.trim(), q = t.slice(0, 3);
    if (q === '"""' || q === "'''") { // python docstring: one line ("""x""") with nothing after it, or an opening line
      const n = t.split(q).length - 1;
      if (n === 1) block = q; else if (n !== 2 || !t.endsWith(q)) return "the code itself was changed";
      added++; continue;
    }
    if (!COMMENT.test(l)) return "the code itself was changed";
    added++;
    if (/^\s*\/\*/.test(l) && !l.includes("*/")) block = "*/"; // multi-line block comment
  }
  while (i < a.length && !a[i].trim()) i++;
  if (i < a.length) return "part of the code is missing from the answer";
  return added ? "" : "no comments were added";
}

function parseCsv(text, sep) { // RFC 4180-style: quoted fields may hold the separator, doubled quotes and newlines
  const rows = []; let row = [], f = "", q = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (q) { if (ch === '"') { if (text[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += ch; }
    else if (ch === '"' && f === "") q = true;
    else if (ch === sep) { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (q) return null;
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
// values only: keys and header names may be chosen by the model; values (strings, numbers) must come from the input
const leaves = (v, acc = []) => { if (v && typeof v === "object") { for (const x of Object.values(v)) leaves(x, acc); } else if (typeof v === "string" || typeof v === "number") acc.push(String(v)); return acc; };
const fromInput = (x, input) => input.includes(x) || input.replace(/\\(.)/g, "$1").includes(x) || (/^-?\d+(\.\d+)?$/.test(x) && inText(x, input.replace(/(\d),(?=\d{3}\b)/g, "$1")));

export function checkAnswer(job, input, out) {
  out = stripFence(out, job); input = nl(input);
  const res = (check, why) => ({ ok: !why, why: why || "", check });
  if (job === "commit") {
    const l = out.split("\n"), c = "commit format and file names";
    if (!l[0].length || l[0].length > 72) return res(c, `subject is ${l[0].length} characters (max 72)`);
    if (/^\s*[#*•-]/.test(l[0])) return res(c, "subject starts with a bullet or heading mark");
    if (l.length > 1 && l[1].trim() !== "") return res(c, "line 2 must be blank");
    const nb = l.filter((x) => /^\s*[-*•] /.test(x)).length; if (nb > 5) return res(c, `${nb} bullets (max 5)`);
    const p = paths(out.replace(/`/g, " ")).find((x) => !input.includes(x)); if (p) return res(c, `names ${p}, which is not in the diff`);
    return res(c, "");
  }
  if (job === "docstrings") return res("code unchanged except comments", docstrings(input, out));
  if (/^convert:/.test(job)) {
    const f = job.slice(8).toLowerCase(), c = `output parses as ${f} and its values come from the input`;
    if (f === "json") {
      let v; try { v = JSON.parse(out); } catch (e) { return res(c, "not valid JSON: " + e.message); }
      const vals = leaves(v).filter((x) => x.length > 1);
      if (!vals.length && /\w{2,}/.test(input)) return res(c, "the JSON is empty");
      const bad = vals.find((x) => !fromInput(x, input)); return res(c, bad === undefined ? "" : `"${bad.slice(0, 60)}" is not in the input`);
    }
    if (f === "csv" || f === "tsv") {
      const rows = f === "csv" ? parseCsv(out, ",") : out.split("\n").filter((x) => x.trim()).map((x) => x.split("\t")); // TSV has no quoting
      if (!rows) return res(c, "a quoted field is never closed");
      if (!rows.length) return res(c, "no rows");
      const n = rows[0].length, bad = rows.findIndex((r) => r.length !== n);
      if (bad >= 0) return res(c, `row ${bad + 1} has ${rows[bad].length} fields, expected ${n}`);
      const v = rows.slice(1).flat().map((x) => x.trim()).find((x) => x.length > 1 && !fromInput(x, input)); // row 1 is the header
      return res(c, v === undefined ? "" : `"${v.slice(0, 60)}" is not in the input`);
    }
    return { ok: false, why: `no check for format "${f}"`, check: "none" };
  }
  if (job === "summarize") {
    const c = "bullets only, no names, numbers or paths missing from the input", rows = out.split("\n").filter((x) => x.trim());
    const bullet = (x) => /^\s*(?:[-•]|\*(?!\*))\s/.test(x), cont = (x) => /^\s{2,}\S/.test(x);
    if (!rows.length || !bullet(rows[0]) || rows.some((x) => !bullet(x) && !cont(x))) return res(c, "every line must be a bullet");
    const nb = rows.filter(bullet).length; if (nb > 12) return res(c, `${nb} bullets (max 12)`);
    return res(c, grounded(out, input));
  }
  if (job === "explain") {
    const c = "length, no names, numbers or paths missing from the input";
    const n = (out.replace(/\b(e\.g|i\.e|etc|vs|cf)\./gi, "x").replace(/^\s*\d+\.\s/gm, "").match(/[^\s\d][.!?](\s|$)/g) || []).length;
    if (n > 10) return res(c, `${n} sentences (max 10)`);
    if (out.length > 4000) return res(c, `${out.length} characters (max 4000)`);
    return res(c, grounded(out, input));
  }
  return { ok: false, why: `no check for job "${job}"`, check: "none" };
}
