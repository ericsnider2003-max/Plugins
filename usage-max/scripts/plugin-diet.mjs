#!/usr/bin/env node
// plugin-diet: measure what loads into EVERY Claude Code session (skills/commands/agents descriptions, CLAUDE.md,
// MCP servers) and how often each source was actually used in the last N days. Proposes cuts; --disable applies plugin cuts.
// Usage: node plugin-diet.mjs [--days 30] [--cwd <dir>] [--json] [--disable plugin@market,...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOK = (chars) => Math.round(chars / 3.6);
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const jread = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

export function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); const o = {};
  if (!m) return o;
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; o[key] = kv[2].replace(/^["'>|-]+|["']+$/g, "").trim(); }
    else if (key && /^\s+\S/.test(line)) o[key] += " " + line.trim();
  }
  return o;
}
// Always-loaded cost of one skill/command/agent file = name + description (bodies load on demand).
const itemCost = (file) => { const f = frontmatter(read(file)); return (f.name || path.basename(path.dirname(file))).length + (f.description || "").length + 8; };

export function scanDir(root) {
  let chars = 0, skills = 0, commands = 0, agents = 0, mcp = 0, hooks = 0;
  for (const e of ls(path.join(root, "skills"))) if (e.isDirectory()) { const f = path.join(root, "skills", e.name, "SKILL.md"); if (fs.existsSync(f)) { chars += itemCost(f); skills++; } }
  for (const e of ls(path.join(root, "commands"))) if (e.isFile() && e.name.endsWith(".md")) { chars += itemCost(path.join(root, "commands", e.name)); commands++; }
  for (const e of ls(path.join(root, "agents"))) if (e.isFile() && e.name.endsWith(".md")) { chars += itemCost(path.join(root, "agents", e.name)); agents++; }
  const mj = jread(path.join(root, ".mcp.json"), null); if (mj) mcp = Object.keys(mj.mcpServers || mj).length;
  const hj = jread(path.join(root, "hooks", "hooks.json"), null); if (hj) hooks = Object.keys(hj.hooks || {}).length;
  return { tokens: TOK(chars), skills, commands, agents, mcp, hooks };
}

export function findPluginDir(claudeDir, id) {
  const [name, market] = id.split("@");
  const inst = jread(path.join(claudeDir, "plugins", "installed_plugins.json"), {});
  const ent = (inst.plugins || inst)[id]; const e0 = Array.isArray(ent) ? ent[0] : ent;
  if (e0 && e0.installPath && fs.existsSync(e0.installPath)) return e0.installPath;
  const base = path.join(claudeDir, "plugins", "cache", market || "", name);
  const vers = ls(base).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (vers.length) return path.join(base, vers[vers.length - 1]);
  return null;
}

// Count real usage from transcripts: Skill tool calls (plugin:skill), mcp__server__ calls, Agent subagent types.
export function usageCounts(claudeDir, days, nowMs = Date.now()) {
  const cut = nowMs - days * 864e5, counts = { skill: {}, mcp: {}, agent: {}, sessions: 0 };
  const walk = (d) => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".jsonl")) { let st; try { st = fs.statSync(p); } catch { continue; } if (st.mtimeMs < cut) continue; counts.sessions++; scan(p); } } };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const scan = (p) => {
    for (const line of read(p).split("\n")) {
      if (!line.includes('"tool_use"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const c = o.message && o.message.content; if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type !== "tool_use") continue;
        if (b.name === "Skill" && b.input && b.input.skill) bump(counts.skill, String(b.input.skill));
        else if (/^mcp__/.test(b.name)) bump(counts.mcp, b.name.split("__")[1]);
        else if ((b.name === "Agent" || b.name === "Task") && b.input && b.input.subagent_type) bump(counts.agent, String(b.input.subagent_type));
      }
    }
  };
  walk(path.join(claudeDir, "projects")); return counts;
}
const usesFor = (name, counts) => {
  const base = name.split("@")[0]; let n = 0;
  for (const [k, v] of Object.entries(counts.skill)) if (k === base || k.startsWith(base + ":")) n += v;
  for (const [k, v] of Object.entries(counts.agent)) if (k.startsWith(base + ":")) n += v;
  for (const [k, v] of Object.entries(counts.mcp)) if (k === base || k.includes(base)) n += v;
  return n;
};

// Plugins synced from claude.ai / an org live under plugins/synced/<org>_<acct>/<plugin>, not in installed_plugins.json.
export function syncedPlugins(claudeDir) {
  const out = [];
  const base = path.join(claudeDir, "plugins", "synced");
  for (const org of ls(base)) {
    if (!org.isDirectory()) continue;
    for (const p of ls(path.join(base, org.name))) {
      if (!p.isDirectory()) continue;
      const dir = path.join(base, org.name, p.name);
      const name = jread(path.join(dir, ".claude-plugin", "plugin.json"), {}).name || p.name;
      if (fs.existsSync(path.join(dir, "skills")) || fs.existsSync(path.join(dir, "commands")) || fs.existsSync(path.join(dir, "agents")) || fs.existsSync(path.join(dir, ".mcp.json"))) out.push({ name, dir });
    }
  }
  return out;
}

// Ground truth: median first-turn context of recent sessions (system prompt + tools + plugins + CLAUDE.md).
export function measuredStartup(claudeDir, days, nowMs = Date.now()) {
  const cut = nowMs - days * 864e5, vals = [];
  const walk = (d) => { for (const e of ls(d)) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "subagents") walk(p); } else if (e.name.endsWith(".jsonl")) { let st; try { st = fs.statSync(p); } catch { continue; } if (st.mtimeMs < cut) continue; for (const line of read(p).split("\n")) { if (!line.includes('"assistant"')) continue; let o; try { o = JSON.parse(line); } catch { continue; } const u = o.type === "assistant" && o.message && o.message.usage; if (u && !o.isSidechain) { vals.push((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)); break; } } } } };
  walk(path.join(claudeDir, "projects"));
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : null;
}

export function diet({ home = os.homedir(), cwd = process.cwd(), days = 30, nowMs = Date.now() } = {}) {
  const claudeDir = path.join(home, ".claude");
  const settings = jread(path.join(claudeDir, "settings.json"), {});
  const counts = usageCounts(claudeDir, days, nowMs);
  const rows = [];
  for (const [id, on] of Object.entries(settings.enabledPlugins || {})) {
    if (!on) continue; const dir = findPluginDir(claudeDir, id);
    const s = dir ? scanDir(dir) : { tokens: 0, skills: 0, commands: 0, agents: 0, mcp: 0, hooks: 0, missing: true };
    rows.push({ kind: "plugin", id, ...s, uses: usesFor(id, counts) });
  }
  const have = new Set(rows.map((r) => r.id.split("@")[0]));
  for (const sp of syncedPlugins(claudeDir)) {
    if (have.has(sp.name)) continue;
    const s2 = scanDir(sp.dir);
    rows.push({ kind: "plugin(synced)", id: sp.name, ...s2, uses: usesFor(sp.name, counts) });
  }
  for (const [kind, dir] of [["user-skills", path.join(claudeDir)], ["project-skills", path.join(cwd, ".claude")]]) {
    const s = scanDir(dir); if (s.skills || s.commands || s.agents) rows.push({ kind, id: kind, ...s, uses: Object.entries(counts.skill).filter(([k]) => !k.includes(":")).reduce((a, [, v]) => a + v, 0) });
  }
  for (const f of [...new Set([path.join(claudeDir, "CLAUDE.md"), path.join(cwd, "CLAUDE.md"), path.join(cwd, ".claude", "CLAUDE.md")])]) {
    const t = read(f); if (t) rows.push({ kind: "CLAUDE.md", id: f, tokens: TOK(t.length), lines: t.split("\n").length, uses: null });
  }
  const mcpUser = Object.keys(jread(path.join(home, ".claude.json"), {}).mcpServers || {});
  const mcpProj = Object.keys((jread(path.join(cwd, ".mcp.json"), {}).mcpServers) || {});
  for (const name of [...new Set([...mcpUser, ...mcpProj])]) rows.push({ kind: "mcp", id: name, tokens: null, uses: counts.mcp[name] || 0 });
  const advice = [];
  for (const r of rows) {
    if (r.kind === "plugin" && r.uses === 0 && r.tokens >= 300) advice.push({ id: r.id, action: "disable", saves: r.tokens, why: `0 uses in ${days}d, ~${r.tokens} tokens in every session` });
    if (r.kind === "plugin(synced)" && r.uses === 0 && (r.tokens >= 300 || r.mcp >= 3)) advice.push({ id: r.id, action: "disable in claude.ai > Settings > Plugins", saves: r.tokens, why: `0 uses in ${days}d, ~${r.tokens} tokens of descriptions${r.mcp ? ` + ${r.mcp} MCP server(s) whose tool definitions also load` : ""} in every session` });
    if (r.kind === "CLAUDE.md" && r.tokens > 700) advice.push({ id: r.id, action: "trim", saves: r.tokens - 500, why: `${r.tokens} tokens (${r.lines} lines); keep <500, move workflows to skills / path-scoped rules` });
    if (r.kind === "mcp" && r.uses === 0) advice.push({ id: r.id, action: "disable via /mcp", saves: null, why: `0 calls in ${days}d (tool names still enter context)` });
  }
  const total = rows.reduce((a, r) => a + (r.tokens || 0), 0);
  return { days, sessionsScanned: counts.sessions, measuredStartupTokens: measuredStartup(claudeDir, days, nowMs), alwaysLoadedTokens: total, rows, advice, savings: advice.reduce((a, x) => a + (x.saves || 0), 0) };
}

export function disablePlugins(home, ids) {
  const f = path.join(home, ".claude", "settings.json"); const s = jread(f, {});
  if (!s.enabledPlugins) return [];
  try { fs.writeFileSync(f + ".usage-max-diet-backup", fs.readFileSync(f), { flag: "wx" }); } catch {}
  const done = []; for (const id of ids) if (id in s.enabledPlugins && s.enabledPlugins[id]) { s.enabledPlugins[id] = false; done.push(id); }
  fs.writeFileSync(f, JSON.stringify(s, null, 2)); return done;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf("--" + n); return i >= 0 ? a[i + 1] : d; };
  const home = process.env.USAGE_MAX_HOME || os.homedir();
  const r = diet({ home, cwd: flag("cwd", process.cwd()), days: Number(flag("days", 30)) });
  const dis = flag("disable", null);
  if (dis) { const done = disablePlugins(home, dis.split(",").map((s) => s.trim()).filter(Boolean)); console.log(done.length ? `disabled: ${done.join(", ")} (backup: settings.json.usage-max-diet-backup). Takes effect in NEW sessions.` : "nothing disabled (ids not enabled)"); process.exit(0); }
  if (a.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`usage-max plugin-diet — always-loaded context (descriptions + CLAUDE.md) ≈ ${r.alwaysLoadedTokens} tokens (${r.sessionsScanned} sessions scanned, ${r.days}d); measured session start (median first turn, includes system prompt + tool definitions): ${r.measuredStartupTokens === null ? "n/a" : r.measuredStartupTokens + " tokens"}`);
  for (const x of r.rows.sort((p, q) => (q.tokens || 0) - (p.tokens || 0))) console.log(`  ${String(x.tokens ?? "?").padStart(6)} tok  ${x.kind.padEnd(14)} ${x.id}${x.uses !== null && x.uses !== undefined ? `  (uses ${x.uses})` : ""}`);
  console.log(r.advice.length ? "\nAdvice:" : "\nNothing obviously removable.");
  for (const x of r.advice) console.log(`  ${x.action.toUpperCase()} ${x.id}: ${x.why}`);
  if (r.savings) console.log(`\nPotential saving ≈ ${r.savings} tokens per session. Apply plugin cuts: --disable id1,id2`);
  console.log("\nNote: counts only what this tool can see locally (descriptions, CLAUDE.md, listed MCP servers). Run /context in a fresh session for the true total, incl. system prompt & tool definitions.");
}
