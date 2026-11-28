// Deterministic per-job checks for local-model answers (used by offload.mjs). A failing answer is never returned.
export function stripFence(s) {
  const l = String(s ?? "").trim().split("\n");
  if (l[0].startsWith("```")) l.shift();
  if (l.length && l[l.length - 1].trim() === "```") l.pop();
  return l.join("\n").trim();
}
const PATH = /(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|rs|go|md|json|ya?ml|toml|ps1|sh|css|html|java|c|h|cpp|cs|rb|php|sql|txt)\b/g;
const JOBS_WITH_CHECK = ["commit", "docstrings", "summarize", "explain"], FORMATS = ["json", "csv", "tsv"];
export const hasCheck = (job) => JOBS_WITH_CHECK.includes(job) || (/^convert:/.test(job) && FORMATS.includes(job.slice(8).toLowerCase()));
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, "").replace(/(^|\s)\/\/.*$/gm, "$1").replace(/(^|\s)#.*$/gm, "$1").replace(/\s+/g, "");
const missing = (out, input) => {
  const toks = [];
  for (const m of out.matchAll(/`([^`\n]+)`/g)) toks.push(m[1]);
  toks.push(...(out.match(/\b\d[\d.,:]*\d\b/g) || []));
  toks.push(...(out.match(/\b[A-Za-z_$][\w$]*\b/g) || []).filter((w) => w.includes("_") || /[a-z][A-Z]/.test(w)));
  toks.push(...(out.match(PATH) || []));
  return toks.find((t) => !input.includes(t));
};
const grounded = (out, input) => { const t = missing(out, input); return t === undefined ? null : `"${t}" is not in the input`; };
export function checkAnswer(job, input, out) {
  out = stripFence(out); input = String(input ?? "");
  const res = (check, why) => ({ ok: !why, why: why || "", check });
  if (job === "commit") {
    const l = out.split("\n"), c = "commit format and file names";
    if (!l[0].length || l[0].length > 72) return res(c, `subject is ${l[0].length} characters (max 72)`);
    if (/^[#*-]/.test(l[0])) return res(c, "subject starts with a bullet or heading mark");
    if (l.length > 1 && l[1] !== "") return res(c, "line 2 must be blank");
    const nb = l.filter((x) => /^[-*] /.test(x)).length; if (nb > 5) return res(c, `${nb} bullets (max 5)`);
    const p = (out.match(PATH) || []).find((x) => !input.includes(x)); if (p) return res(c, `names ${p}, which is not in the diff`);
    return res(c, "");
  }
  if (job === "docstrings") {
    const c = "code unchanged except comments";
    const src = input.replace(/^### .*$/gm, ""), notes = (s) => s.replace(/s+/g, "").length - code(s).length; // offload adds "### <file>" headers
    if (code(out) !== code(src)) return res(c, "the code itself was changed");
    if (notes(out) <= notes(src)) return res(c, "no comments were added");
    return res(c, "");
  }
  if (/^convert:/.test(job)) {
    const f = job.slice(8).toLowerCase(), c = `output parses as ${f}`;
    if (f === "json") { try { JSON.parse(out); return res(c, ""); } catch (e) { return res(c, "not valid JSON: " + e.message); } }
    if (f === "csv" || f === "tsv") {
      const sep = f === "csv" ? "," : "\t", rows = out.split("\n").filter((x) => x.trim());
      if (!rows.length) return res(c, "no rows");
      const n = rows[0].split(sep).length, bad = rows.findIndex((x) => x.split(sep).length !== n);
      return res(c, bad < 0 ? "" : `row ${bad + 1} has ${rows[bad].split(sep).length} fields, expected ${n}`);
    }
    return { ok: false, why: `no check for format "${f}"`, check: "none" };
  }
  if (job === "summarize") {
    const c = "bullets only, no names or numbers missing from the input", rows = out.split("\n").filter((x) => x.trim());
    if (rows.some((x) => !/^\s*[-*•]/.test(x))) return res(c, "every line must be a bullet");
    if (rows.length > 12) return res(c, `${rows.length} bullets (max 12)`);
    return res(c, grounded(out, input) || "");
  }
  if (job === "explain") {
    const c = "length, no names or numbers missing from the input", n = out ? Math.max(1, (out.match(/[.!?](\s|$)/g) || []).length) : 0;
    if (n > 10) return res(c, `${n} sentences (max 10)`);
    return res(c, grounded(out, input) || "");
  }
  return { ok: false, why: `no check for job "${job}"`, check: "none" };
}
