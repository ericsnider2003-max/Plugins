#!/usr/bin/env node
// Installs usage-max into Codex: skill, AGENTS.md block, notify hook, profiles. Idempotent; backs up config.toml.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { codexHome, setTopLevel, writeProfiles, loadConfig, applyMode, evaluate } from "./codex-governor.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const ch = codexHome(); fs.mkdirSync(ch, { recursive: true });
// 1. skill (user skills dir)
const sk = path.join(ch, "skills", "usage-max"); fs.mkdirSync(sk, { recursive: true });
fs.copyFileSync(path.join(root, "skills/usage-max/SKILL.md"), path.join(sk, "SKILL.md"));
// 2. AGENTS.md managed block
const ag = path.join(ch, "AGENTS.md"); let a = ""; try { a = fs.readFileSync(ag, "utf8"); } catch {}
const blk = fs.readFileSync(path.join(root, "AGENTS.usage-max.md"), "utf8").trim();
const re = /<!-- usage-max:start -->[\s\S]*?<!-- usage-max:end -->/;
a = re.test(a) ? a.replace(re, blk) : (a ? a.replace(/\n*$/, "\n\n") : "") + blk + "\n"; fs.writeFileSync(ag, a);
// 3. notify hook (only if user has none, or ours)
const cf = path.join(ch, "config.toml"); let t = ""; try { t = fs.readFileSync(cf, "utf8"); } catch {}
const notify = path.join(root, "scripts", "notify.mjs").replace(/\\/g, "/"); const m = t.match(/^\s*notify\s*=.*$/m);
if (!m || m[0].includes("usage-max") || m[0].includes("notify.mjs")) { if (t) { try { fs.writeFileSync(cf + ".usage-max-backup", t, { flag: "wx" }); } catch {} } t = setTopLevel(t, {}); 
  const line = `notify = ["node", ${JSON.stringify(notify)}]`; t = m ? t.replace(/^\s*notify\s*=.*$/m, line) : (() => { const L = t.split("\n"); let i = L.findIndex(l => /^\s*\[/.test(l)); if (i < 0) i = L.length; L.splice(i, 0, line); return L.join("\n"); })(); fs.writeFileSync(cf, t.replace(/\n*$/, "\n")); console.log("notify hook set"); }
else console.log("existing notify= left untouched; run `node scripts/notify.mjs` from your own notifier to keep metering");
// 4. hooks.json (merge, idempotent). Codex asks you to trust non-managed hooks once: run /hooks in Codex.
{
  const hf = path.join(ch, "hooks.json"); let hj = {}; try { hj = JSON.parse(fs.readFileSync(hf, "utf8")); } catch {}
  hj.hooks = hj.hooks || {}; const hs = path.join(root, "scripts", "codex-hook.mjs").replace(/\\/g, "/");
  const entry = (ev, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `node "${hs}" ${ev}`, timeout: 15, statusMessage: "usage-max" }] });
  for (const [ev, matcher] of [["SessionStart"], ["UserPromptSubmit"], ["Stop"], ["PreToolUse", "Bash"]]) {
    const arr = (hj.hooks[ev] = (hj.hooks[ev] || []).filter((g) => !JSON.stringify(g).includes("codex-hook.mjs"))); arr.push(entry(ev, matcher));
  }
  try { fs.writeFileSync(hf + ".usage-max-backup", fs.readFileSync(hf), { flag: "wx" }); } catch {}
  fs.writeFileSync(hf, JSON.stringify(hj, null, 2)); console.log("hooks.json merged (run /hooks in Codex once to trust them)");
}
writeProfiles(loadConfig()); const { mode, cfg } = evaluate(); applyMode(mode, cfg);
console.log(`installed. mode=${mode}. Next: node scripts/codex-governor.mjs calibrate <pct from /status> --resets <ISO>`);
