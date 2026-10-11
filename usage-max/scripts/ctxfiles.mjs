// What the model re-reads on EVERY turn: CLAUDE.md / AGENTS.md files and the files they @-import. Reports size, never deletes.
// `--archive <file>` moves one file into <its folder>/.usage-max-archive/ (reversible: move it back).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tok = (b) => Math.round(b / 4);
const DAY = 864e5;
export function scan({ home = process.env.USAGE_MAX_HOME || os.homedir(), cwd = process.cwd() } = {}) {
  const roots = [path.join(home, ".claude", "CLAUDE.md"), path.join(home, ".codex", "AGENTS.md")];
  for (let d = path.resolve(cwd), i = 0; i < 6; i++, d = path.dirname(d)) { for (const n of ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]) roots.push(path.join(d, n)); if (path.dirname(d) === d) break; }
  const seen = new Map();
  const visit = (f, via, depth) => {
    f = path.resolve(f); if (seen.has(f) || depth > 4) return; let st; try { st = fs.statSync(f); } catch { return; } if (!st.isFile()) return;
    seen.set(f, { file: f, via, bytes: st.size, lines: 0, tokens: tok(st.size), ageDays: Math.round((Date.now() - st.mtimeMs) / DAY) });
    if (st.size > 400000) return; let text = ""; try { text = fs.readFileSync(f, "utf8"); } catch { return; }
    seen.get(f).lines = text.split("\n").length;
    for (const m of text.matchAll(/(?:^|\s)@((?:~|\.{1,2})?[\w./\\ -]*[\w.-]+\.(?:md|txt|mdx))/g)) {
      const p = m[1].startsWith("~") ? path.join(home, m[1].slice(1)) : path.resolve(path.dirname(f), m[1]); visit(p, f, depth + 1);
    }
  };
  for (const r of roots) visit(r, null, 0);
  const rows = [...seen.values()]; const total = rows.reduce((a, r) => a + r.tokens, 0);
  const advice = [];
  for (const r of rows) {
    if (r.tokens > 2500) advice.push({ file: r.file, why: `${r.tokens} tokens loaded on every turn: trim it to the rules that change behaviour, move reference material to a file read on demand` });
    if (!r.via && r.lines > 200) advice.push({ file: r.file, why: `${r.lines} lines (Anthropic suggests under about 200): move workflow-specific parts into skills, which load only when used. Long, auto-generated instruction files (/init) raised cost without helping in one study, so prune them` });
    if (r.via && r.ageDays > 90 && r.tokens > 300) advice.push({ file: r.file, why: `imported file untouched for ${r.ageDays} days (${r.tokens} tokens per turn): archive it if it is no longer needed` });
  }
  let memory = []; try { const ip = JSON.parse(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8")); memory = Object.keys(ip.plugins || ip).filter((n) => /mem|obsidian|memory/i.test(n)); } catch {}
  return { rows, total, advice, memory };
}
export function archive(file) {
  const f = path.resolve(file); if (!fs.existsSync(f)) return { error: `no such file: ${f}` };
  const d = path.join(path.dirname(f), ".usage-max-archive"); fs.mkdirSync(d, { recursive: true });
  let dst = path.join(d, path.basename(f)); for (let i = 2; fs.existsSync(dst); i++) dst = path.join(d, `${i}-${path.basename(f)}`);
  fs.renameSync(f, dst); return { from: f, to: dst };
}
function main() {
  const a = process.argv.slice(2); const i = a.indexOf("--archive");
  if (i >= 0) { const r = archive(a[i + 1] || ""); console.log(r.error || `moved ${r.from}\n  to ${r.to}\n(undo: move it back; if CLAUDE.md imports it with @, update that line)`); process.exit(r.error ? 1 : 0); }
  const r = scan({ cwd: process.cwd() });
  console.log(`always-loaded instruction files for ${process.cwd()}: ${r.rows.length} files, about ${r.total} tokens on EVERY turn (cached, but re-read each turn)`);
  for (const x of r.rows.sort((p, q) => q.tokens - p.tokens)) console.log(`  ${String(x.tokens).padStart(6)} tok  ${x.ageDays}d old  ${x.file}${x.via ? "  (imported by " + path.basename(x.via) + ")" : ""}`);
  if (r.advice.length) { console.log("\nsuggestions (nothing is changed automatically):"); for (const x of r.advice) console.log(`  - ${x.file}\n    ${x.why}`); }
  else console.log("\nnothing oversized or stale.");
  console.log(r.memory.length ? `\nmemory plugins installed: ${r.memory.join(", ")} (they can spend tokens in the background to summarise your work, and they inject context at session start: check with /usage-max diet and /usage; turn one off if you do not use its recall)` : "");
  console.log("\narchive one (reversible): usage-max context --archive <file>");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
