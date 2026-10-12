#!/usr/bin/env node
// Installs usage-max into Codex: skill, AGENTS.md block, notify hook, profiles. Idempotent; backs up config.toml.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { codexHome, dataDir, setTopLevel, writeProfiles, loadConfig, applyMode, evaluate, markInstalled, modelsSeen, weightFor, DEFAULT_CONFIG } from "./codex-governor.mjs";
import { binDir, syncBin } from "./sync.mjs";
import { editText } from "./safefile.mjs";
const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."); const sr = syncBin({ root: plugin, force: true }); if (sr.error) console.error("sync to stable dir failed (using existing copy if any):", sr.error);
const root = binDir(); const ch = codexHome(); fs.mkdirSync(ch, { recursive: true });
// 1. skill (user skills dir)
const sk = path.join(ch, "skills", "usage-max"); fs.mkdirSync(sk, { recursive: true });
const rp = root.replace(/\\/g, "/"); const sub = (s) => s.split("<usage-max>").join(rp);
fs.writeFileSync(path.join(sk, "SKILL.md"), sub(fs.readFileSync(path.join(root, "skills/usage-max/SKILL.md"), "utf8")));
// 2. AGENTS.md managed block (an unreadable file is never treated as empty: it is left alone and the failure is shown)
const ag = path.join(ch, "AGENTS.md");
const blk = fs.readFileSync(path.join(root, "AGENTS.usage-max.md"), "utf8").trim().split("<usage-max>").join(rp);
const re = /<!-- usage-max:start -->[\s\S]*?<!-- usage-max:end -->/;
{ const r = editText(ag, (a) => re.test(a) ? a.replace(re, () => blk) : (a ? a.replace(/\n*$/, "\n\n") : "") + blk + "\n"); if (r.error) console.error("AGENTS.md NOT updated: " + r.error); }
// 3. notify hook (only if user has none, or ours)
const cf = path.join(ch, "config.toml");
const notify = path.join(root, "scripts", "notify.mjs").replace(/\\/g, "/");
{ const r = editText(cf, (t) => {
    const m = t.match(/^\s*notify\s*=.*$/m);
    if (m && !m[0].includes("usage-max") && !m[0].includes("notify.mjs")) { console.log(`existing notify= left untouched; run node ${rp}/scripts/notify.mjs from your own notifier to keep metering`); return null; }
    const line = `notify = ["node", ${JSON.stringify(notify)}]`; t = setTopLevel(t, {});
    t = m ? t.replace(/^\s*notify\s*=.*$/m, line) : (() => { const L = t.split("\n"); let i = L.findIndex(l => /^\s*\[/.test(l)); if (i < 0) i = L.length; L.splice(i, 0, line); return L.join("\n"); })();
    return t.replace(/\n*$/, "\n");
  }); if (r.error) console.error("config.toml notify NOT set: " + r.error); else if (r.changed) console.log("notify hook set"); }
// 4. hooks.json (merge, idempotent). Codex asks you to trust non-managed hooks once: run /hooks in Codex.
{
  const hf = path.join(ch, "hooks.json"); const hs = path.join(root, "scripts", "codex-hook.mjs").replace(/\\/g, "/");
  const entry = (ev, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: `node "${hs}" ${ev}`, timeout: 15, statusMessage: "usage-max" }] });
  const r = editText(hf, (txt) => {
    let hj = {}; if (txt.trim()) { try { hj = JSON.parse(txt); } catch { throw new Error("hooks.json is not valid JSON, so it was not touched (fix or move it, then run install again)"); } }
    hj.hooks = hj.hooks || {};
    for (const [ev, matcher] of [["SessionStart"], ["UserPromptSubmit"], ["Stop"], ["PreToolUse", "Bash"]]) {
      const arr = (hj.hooks[ev] = (hj.hooks[ev] || []).filter((g) => !JSON.stringify(g).includes("codex-hook.mjs"))); arr.push(entry(ev, matcher));
    }
    return JSON.stringify(hj, null, 2);
  });
  if (r.error) console.error("hooks.json NOT updated: " + r.error); else console.log("hooks.json merged (run /hooks in Codex once to trust them)");
}
// 5. seed config.json modes from models seen in sessions (never overwrite)
{
  const cj = path.join(dataDir(), "config.json");
  if (!fs.existsSync(cj)) {
    const seen = Object.entries(modelsSeen()).sort((x, y) => y[1] - x[1]).map(([k]) => k);
    if (seen.length >= 2) {
      const cfg0 = DEFAULT_CONFIG, top = seen[0], cheap = seen.reduce((b, x) => weightFor(x, cfg0) < weightFor(b, cfg0) ? x : b, seen[0]);
      const mode = (model, effort) => ({ model, effort, service_tier: null });
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(cj, JSON.stringify({ modes: { green: mode(top, "medium"), amber: mode(top, "low"), red: mode(cheap, "low") } }, null, 2)); console.log(`config.json seeded: green/amber=${top} red=${cheap}`);
    }
  }
}
writeProfiles(loadConfig()); markInstalled(); const { mode, cfg, st: ist } = evaluate(); applyMode(mode, cfg, Boolean(ist && ist.surplus && mode === "green"));
console.log(`installed. mode=${mode}.
REQUIRED once: start Codex and run /hooks, then trust the usage-max hooks. Codex silently skips untrusted hooks, so until you do this usage-max does nothing in Codex.
Calibration is automatic (read from Codex's own rate_limits) after your first Codex turn. Verify anytime: node "${rp}/scripts/codex-governor.mjs" doctor`);
