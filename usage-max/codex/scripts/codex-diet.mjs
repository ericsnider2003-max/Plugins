#!/usr/bin/env node
// codex-diet: audit what loads into every Codex turn — AGENTS.md size, MCP servers (tools, timeouts), skills, compaction config.
// node codex-diet.mjs [--cwd dir] [--json] [--apply] [--disable-mcp name1,name2]
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { codexHome, setTopLevel } from "./codex-governor.mjs";
import { editText } from "./safefile.mjs";
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const TOK = (c) => Math.round(c / 3.6);
export function audit({ cwd = process.cwd(), home = codexHome() } = {}) {
  const cfgText = read(path.join(home, "config.toml")); const rows = [], advice = [];
  const agents = [path.join(home, "AGENTS.md"), path.join(home, "AGENTS.override.md")];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) { agents.push(path.join(d, "AGENTS.md")); if (fs.existsSync(path.join(d, ".git")) || path.dirname(d) === d) break; }
  for (const f of agents) { const t = read(f); if (!t) continue; rows.push({ kind: "AGENTS.md", id: f, bytes: Buffer.byteLength(t), tokens: TOK(t.length) }); if (Buffer.byteLength(t) > 4096) advice.push({ id: f, action: "trim", why: `${Buffer.byteLength(t)} B (>4 KB; cap 32 KiB silently truncates). Move reference material to on-demand files/skills.`, saves: TOK(t.length) - 1100 }); }
  const mcp = [...cfgText.matchAll(/^\[mcp_servers\.([^\].]+)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)];
  for (const m of mcp) { const body = m[2]; const off = /^\s*enabled\s*=\s*false/m.test(body); rows.push({ kind: "mcp", id: m[1], off }); if (!off && !/enabled_tools/.test(body)) advice.push({ id: m[1], action: "scope", why: "no enabled_tools — every tool schema loads each turn; list only the tools you use", saves: null }); if (!off && !/timeout/.test(body)) advice.push({ id: m[1], action: "timeout", why: "no timeout_seconds", saves: null }); }
  let skills = 0, sk = 0; const walk = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "SKILL.md") { skills++; const m = read(p).match(/description:\s*(.*)/); sk += (m ? m[1].length : 0) + 30; } } } catch {} };
  walk(path.join(home, "skills")); if (skills) rows.push({ kind: "skills", id: `${skills} skills`, tokens: TOK(sk) });
  const mm = cfgText.match(/^\s*model\s*=\s*"([^"]+)"/m);
  if (mm && /gpt-5\.5\b/.test(mm[1])) advice.push({ id: "config.toml", action: "migrate", why: `model ${mm[1]} retires from ChatGPT/Codex on 2026-10-14; pick a current one (codex-governor.mjs models)`, saves: null });
  if (/^\s*service_tier\s*=\s*"fast"/m.test(cfgText)) advice.push({ id: "config.toml", action: "unset", why: "service_tier=fast spends included limits at 2.5x (Ultrafast 8x)", saves: null });
  if (!read(path.join(home, "hooks.json")).includes("codex-hook.mjs")) advice.push({ id: "hooks.json", action: "install", why: "usage-max hooks not installed (node scripts/install.mjs, then trust via /hooks)", saves: null });
  if (!/^\s*compact_prompt\s*=/m.test(cfgText)) advice.push({ id: "config.toml", action: "set", why: "no compact_prompt — compaction keeps dead ends", saves: null });
  return { rows, advice, always: rows.reduce((a, r) => a + (r.tokens || 0), 0) };
}
export function apply(home = codexHome(), disable = []) {
  const f = path.join(home, "config.toml"); const kv = {}; // never sets tool_output_token_limit / model_auto_compact_token_limit: smaller values make Codex lose project detail
  const r = editText(f, (t) => {
    if (!/^\s*compact_prompt\s*=/m.test(t)) kv.compact_prompt = "Summarize for continuation: keep user goal, decisions made, file paths touched, current errors and exact next step. Drop dead ends, raw tool output and repeated reasoning.";
    t = setTopLevel(t, kv);
    for (const name of disable) { // inside that server's own table only: an `enabled =` in a LATER table must not stop this one
      const hdr = new RegExp(`^\\[mcp_servers\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][ \\t]*\\r?$`, "m"), h = hdr.exec(t); if (!h) continue;
      const bodyStart = h.index + h[0].length + 1, nx = t.slice(bodyStart).search(/^\s*\[/m), bodyEnd = nx < 0 ? t.length : bodyStart + nx;
      if (/^\s*enabled\s*=/m.test(t.slice(bodyStart, bodyEnd))) continue;
      t = t.slice(0, bodyStart) + "enabled = false\n" + t.slice(bodyStart);
    }
    return t.replace(/\n*$/, "\n");
  });
  return { set: r.error ? [] : Object.keys(kv), disabled: r.error ? [] : disable, ...(r.error ? { error: r.error } : {}) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const flag = (n) => { const i = a.indexOf("--" + n); return i >= 0 ? a[i + 1] : null; };
  if (a.includes("--apply") || flag("disable-mcp")) { const r = apply(codexHome(), (flag("disable-mcp") || "").split(",").filter(Boolean)); if (r.error) { console.error("NOT applied: " + r.error); process.exit(1); } console.log(`applied: set ${r.set.join(", ") || "nothing new"}; disabled MCP: ${r.disabled.join(", ") || "none"} (previous version kept as config.toml.usage-max-backup-<time>)`); process.exit(0); }
  const r = audit({ cwd: flag("cwd") || process.cwd() });
  if (a.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`usage-max codex-diet — measurable always-loaded ≈ ${r.always} tokens (excludes MCP tool schemas & system prompt; check /status)`);
  for (const x of r.rows) console.log(`  ${String(x.tokens ?? "?").padStart(6)} tok  ${x.kind.padEnd(10)} ${x.id}${x.off ? " (disabled)" : ""}`);
  for (const x of r.advice) console.log(`  ${x.action.toUpperCase()} ${x.id}: ${x.why}`);
  if (r.advice.length) console.log("\nApply safe config fixes: --apply   Disable unused MCP: --disable-mcp name1,name2");
}
