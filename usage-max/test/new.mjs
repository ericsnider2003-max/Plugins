import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "umn-"));
// ---- plugin-diet
const { diet, disablePlugins } = await import(pathToFileURL(path.join(root, "scripts/plugin-diet.mjs")).href);
const cd = path.join(tmp, ".claude"); const pd = path.join(cd, "plugins/cache/mk/bigplug/1.0.0"); const pd2 = path.join(cd, "plugins/cache/mk/used/1.0.0");
for (const [d, nm, desc] of [[pd, "bigplug", "x".repeat(2400)], [pd2, "used", "small"]]) { fs.mkdirSync(path.join(d, "skills/s1"), { recursive: true }); fs.writeFileSync(path.join(d, "skills/s1/SKILL.md"), `---\nname: s1\ndescription: ${desc}\n---\nbody`); }
fs.writeFileSync(path.join(cd, "settings.json"), JSON.stringify({ enabledPlugins: { "bigplug@mk": true, "used@mk": true, "off@mk": false } }));
fs.writeFileSync(path.join(cd, "CLAUDE.md"), "word ".repeat(1200));
const proj = path.join(cd, "projects/p"); fs.mkdirSync(proj, { recursive: true });
fs.writeFileSync(path.join(proj, "s.jsonl"), JSON.stringify({ message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "used:s1" } }] } }) + "\n");
t("diet measures + advises", () => { const r = diet({ home: tmp, cwd: tmp }); const big = r.rows.find((x) => x.id === "bigplug@mk"); assert.ok(big.tokens > 600); assert.equal(big.uses, 0); assert.equal(r.rows.find((x) => x.id === "used@mk").uses, 1); assert.ok(r.advice.some((a) => a.id === "bigplug@mk" && a.action === "disable")); assert.ok(!r.advice.some((a) => a.id === "used@mk")); assert.ok(r.advice.some((a) => a.action === "trim")); assert.ok(!r.rows.some((x) => x.id === "off@mk")); });
t("diet --disable edits settings with backup", () => { const d = disablePlugins(tmp, ["bigplug@mk"]); assert.deepEqual(d, ["bigplug@mk"]); const s = JSON.parse(fs.readFileSync(path.join(cd, "settings.json"))); assert.equal(s.enabledPlugins["bigplug@mk"], false); assert.equal(s.enabledPlugins["used@mk"], true); assert.ok(fs.existsSync(path.join(cd, "settings.json.usage-max-diet-backup"))); });
t("diet CLI runs", () => { const r = spawnSync("node", [path.join(root, "scripts/plugin-diet.mjs"), "--cwd", tmp], { env: { ...process.env, USAGE_MAX_HOME: tmp }, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /always-loaded context/); });
// ---- eval-cache
const ec = path.join(root, "scripts/eval-cache.mjs"); const eh = { ...process.env, USAGE_MAX_HOME: tmp }; delete eh.USAGE_MAX_EVAL_CACHE;
const skill = path.join(tmp, "skill"); fs.mkdirSync(skill); fs.writeFileSync(path.join(skill, "SKILL.md"), "v1");
const counter = path.join(tmp, "counter.txt"); const art = path.join(tmp, "out"); fs.mkdirSync(art);
const cmd = ["node", "-e", `require('fs').appendFileSync(${JSON.stringify(counter)},'x');require('fs').writeFileSync(${JSON.stringify(art + "/r.txt")},'res');console.log('EVALDONE')`];
const ecr = (...extra) => spawnSync("node", [ec, "--key", skill, "--artifacts", art, ...extra, "--", ...cmd], { env: eh, encoding: "utf8" });
t("eval-cache miss runs", () => { const r = ecr(); assert.equal(r.status, 0); assert.match(r.stdout, /EVALDONE/); assert.equal(fs.readFileSync(counter, "utf8"), "x"); });
t("eval-cache hit skips, replays stdout, restores artifacts", () => { fs.rmSync(path.join(art, "r.txt")); const r = ecr(); assert.equal(r.status, 0); assert.match(r.stdout, /EVALDONE/); assert.match(r.stderr, /HIT/); assert.equal(fs.readFileSync(counter, "utf8"), "x"); assert.equal(fs.readFileSync(path.join(art, "r.txt"), "utf8"), "res"); });
t("eval-cache invalidates on key change", () => { fs.writeFileSync(path.join(skill, "SKILL.md"), "v2"); ecr(); assert.equal(fs.readFileSync(counter, "utf8"), "xx"); });
t("eval-cache --force reruns; failures not cached", () => { ecr("--force"); assert.equal(fs.readFileSync(counter, "utf8"), "xxx"); const f = spawnSync("node", [ec, "--key", skill, "--salt", "fail", "--", "node", "-e", "process.exit(3)"], { env: eh }); assert.equal(f.status, 3); const f2 = spawnSync("node", [ec, "--key", skill, "--salt", "fail", "--", "node", "-e", "process.exit(3)"], { env: eh, encoding: "utf8" }); assert.doesNotMatch(f2.stderr, /HIT/); });
t("eval-cache status/clear + off switch", () => { assert.match(spawnSync("node", [ec, "status"], { env: eh, encoding: "utf8" }).stdout, /entries/); spawnSync("node", [ec, "clear"], { env: eh }); const r = spawnSync("node", [ec, "--key", skill, "--", ...cmd], { env: { ...eh, USAGE_MAX_EVAL_CACHE: "off" }, encoding: "utf8" }); assert.equal(r.status, 0); });
// ---- trim + hook
const { trim } = await import(pathToFileURL(path.join(root, "scripts/trim.mjs")).href);
t("trim keeps head/tail/errors, collapses rest", () => { const L = Array.from({ length: 400 }, (_, i) => i === 200 ? "ERROR boom" : `line ${i}`).join("\n"); const o = trim(L); assert.ok(o.includes("ERROR boom") && o.includes("line 0") && o.includes("line 399") && o.includes("trimmed")); assert.ok(o.split("\n").length < 160); assert.equal(trim("short\nout"), "short\nout"); });
const hook = (cmd, env = {}) => spawnSync("node", [path.join(root, "hooks/bash-trim.mjs")], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }), encoding: "utf8", env: { ...process.env, ...env } });
t("hook rewrites noisy simple cmds only", () => { const o = JSON.parse(hook("npm test").stdout); assert.match(o.hookSpecificOutput.updatedInput.command, /^set -o pipefail; npm test 2>&1 \| node ".*trim.mjs"$/); assert.equal(hook("npm test | tee x").stdout, ""); assert.equal(hook("ls -la").stdout, ""); assert.equal(hook("pytest --json").stdout, ""); assert.equal(hook("npm test", { USAGE_MAX_TRIM: "off" }).stdout, ""); });
t("hook fail-open on garbage", () => { const r = spawnSync("node", [path.join(root, "hooks/bash-trim.mjs")], { input: "{{{", encoding: "utf8" }); assert.equal(r.status, 0); assert.equal(r.stdout, ""); });
if (process.platform !== "win32") t("rewritten command preserves exit status & trims", () => { const o = JSON.parse(hook("pytest").stdout); const c = o.hookSpecificOutput.updatedInput.command.replace(/^set -o pipefail; pytest/, "set -o pipefail; (for i in $(seq 1 500); do echo l$i; done; exit 4)"); const r = spawnSync("bash", ["-c", c], { encoding: "utf8" }); assert.equal(r.status, 4); assert.match(r.stdout, /trimmed/); });
// ---- regressions for the analysis fixes
const lib = await import(pathToFileURL(path.join(root, "scripts/lib.mjs")).href);
const pricing = await import(pathToFileURL(path.join(root, "scripts/pricing.mjs")).href);
const gov = await import(pathToFileURL(path.join(root, "scripts/governor.mjs")).href);
const dupDir = fs.mkdtempSync(path.join(os.tmpdir(), "umdup-")); fs.mkdirSync(path.join(dupDir, "p"));
const rec = (blocks, ms) => JSON.stringify({ type: "assistant", timestamp: new Date(Date.parse("2026-10-07T00:00:00Z") + ms).toISOString(), isSidechain: false, message: { id: "msg_1", model: "claude-opus-5-5", content: blocks, usage: { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20000 } } });
fs.writeFileSync(path.join(dupDir, "p/s.jsonl"), [rec([{ type: "thinking" }], 0), rec([{ type: "text", text: "x" }], 100), rec([{ type: "tool_use", name: "Bash", input: { command: "ls" } }], 200)].join("\n") + "\n");
const dup = await lib.summarizeProjects({ projectsDir: dupDir });
t("one message split into 3 transcript records is counted once", () => { assert.equal(dup.assistantTurns, 1); assert.equal(dup.models["claude-opus-5-5"].created, 1000); assert.equal(dup.models["claude-opus-5-5"].toolCalls, 1); });
t("list-price cost is computed and deduped", () => { const want = (10 * 4 + 1000 * 8 + 20000 * 0.2 + 100 * 20) / 1e6; assert.ok(Math.abs(dup.models["claude-opus-5-5"].cost - want) < 1e-9, String(dup.models["claude-opus-5-5"].cost)); });
{ const meter = await import(pathToFileURL(path.join(root, "scripts/meter.mjs")).href); const r = meter.scanFrom(path.join(dupDir, "p/s.jsonl"), 0, 0, new Set());
t("meter counts a split message once", () => assert.ok(Math.abs(r.cost - (10 * 4 + 1000 * 8 + 20000 * 0.2 + 100 * 20) / 1e6) < 1e-9)); }
t("every Haiku model is priced (never $0)", () => { for (const m of ["claude-haiku-4-5-20251001", "claude-haiku-5-5"]) assert.ok(pricing.priceFor(m), m); });
t("weekly reset rolls the window to 0% and the next week", () => { const now = Date.now(); const st = { mode: "red", k: 1, calib: { pct: 95, at: now - 10 * 36e5, cumAt: 0, resetsAt: Math.floor((now - 36e5) / 1000) } }; const m = { cum: 0, offsets: {}, buckets: {} };
  assert.equal(gov.rollWindow(st, m, now), true); const e = gov.estimate(st, m, now, gov.DEFAULT_CONFIG); assert.equal(e.estPct, 0); assert.ok(e.hoursLeft > 160 && e.hoursLeft < 168); assert.equal(gov.rollWindow(st, m, now), false); });
const prof = await import(pathToFileURL(path.join(root, "scripts/profile.mjs")).href);
t("profile apply creates settings.json, backs up, is idempotent, keeps foreign keys", () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "umprof-")); process.env.USAGE_MAX_HOME = h;
  const r1 = prof.apply({ write: true, home: h }); assert.ok(r1.wrote); const s1 = JSON.parse(fs.readFileSync(path.join(h, ".claude/settings.json"), "utf8")); assert.equal(s1.promptCacheTtl, "5m"); assert.equal(s1.model, "claude-opus-5-5"); assert.match(s1.statusLine.command, /usage-max.statusline\.mjs/); assert.equal(s1.extraKnownMarketplaces["eric-plugins"].autoUpdate, true); assert.ok(fs.existsSync(path.join(h, ".claude/usage-max/root.json")));
  const r2 = prof.apply({ write: true, home: h }); assert.equal(r2.wrote, false);
  s1.theme = "dark"; s1.statusLine = { type: "command", command: "my-own-line" }; s1.promptCacheTtl = "1h"; fs.writeFileSync(path.join(h, ".claude/settings.json"), JSON.stringify(s1));
  const r3 = prof.apply({ write: true, home: h }); assert.ok(r3.wrote); assert.ok(r3.backup && fs.existsSync(r3.backup)); const s3 = JSON.parse(fs.readFileSync(path.join(h, ".claude/settings.json"), "utf8")); assert.equal(s3.theme, "dark"); assert.equal(s3.statusLine.command, "my-own-line"); assert.equal(s3.promptCacheTtl, "5m"); delete process.env.USAGE_MAX_HOME; });
t("profile apply refuses to touch invalid settings.json", () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "umprof2-")); fs.mkdirSync(path.join(h, ".claude")); fs.writeFileSync(path.join(h, ".claude/settings.json"), "{not json"); const r = prof.apply({ write: true, home: h }); assert.ok(r.error); assert.equal(fs.readFileSync(path.join(h, ".claude/settings.json"), "utf8"), "{not json"); });
t("diet sees org-synced plugins", () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "umsync-")); const pd = path.join(h, ".claude/plugins/synced/org_acct/bigsync"); fs.mkdirSync(path.join(pd, "skills/s1"), { recursive: true }); fs.mkdirSync(path.join(pd, ".claude-plugin"));
  fs.writeFileSync(path.join(pd, ".claude-plugin/plugin.json"), JSON.stringify({ name: "bigsync" })); fs.writeFileSync(path.join(pd, "skills/s1/SKILL.md"), `---\nname: s1\ndescription: ${"y".repeat(2400)}\n---\n`);
  const r = diet({ home: h, cwd: h }); assert.ok(r.rows.some((x) => x.id === "bigsync" && x.kind === "plugin(synced)" && x.tokens > 600)); assert.ok(r.advice.some((a) => a.id === "bigsync" && /claude\.ai/.test(a.action))); });
// ---- governor learns from real plan percentages (no manual calibrate, no k needed)
{
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), "umgov-")); process.env.USAGE_MAX_HOME = dd; const ud = path.join(dd, ".claude/usage-max"); fs.mkdirSync(ud, { recursive: true });
  const now = Date.now(); const resets = Math.floor((now + 36 * 3600e3) / 1000);
  const run = (snaps, five = null) => { fs.writeFileSync(path.join(ud, "governor.json"), JSON.stringify({ mode: "green", override: null, calib: null, k: null, sessionsNotified: {}, history: [] }));
    for (const x of snaps) { fs.writeFileSync(path.join(ud, "limits.json"), JSON.stringify({ capturedAt: new Date(x.at).toISOString(), seven_day: { used_percentage: x.pct, resets_at: resets }, five_hour: five })); gov.evaluate({ meter: { cum: 0, offsets: {}, buckets: {} }, nowMs: x.at }); }
    return gov.evaluate({ meter: { cum: 0, offsets: {}, buckets: {} }, nowMs: now }); };
  t("steady pace (67% -> 68% over 6h, 36h left) stays GREEN without any calibrate/k", () => { const s = run([{ at: now - 6 * 3600e3, pct: 67 }, { at: now - 3 * 3600e3, pct: 67.5 }, { at: now - 60e3, pct: 68 }]); assert.equal(s.mode, "green"); assert.equal(s.last.rateSource, "plan %"); assert.ok(s.last.estPct > 67.9); });
  t("burning 85% -> 94% in 4h with 36h left goes RED from plan % alone", () => { const s = run([{ at: now - 4 * 3600e3, pct: 85 }, { at: now - 2 * 3600e3, pct: 90 }, { at: now - 60e3, pct: 94 }]); assert.equal(s.mode, "red"); });
  t("5-hour window at 96% forces RED even when the week is fine", () => { const s = run([{ at: now - 6 * 3600e3, pct: 20 }, { at: now - 60e3, pct: 21 }], { used_percentage: 96, resets_at: Math.floor(now / 1000) + 3600 }); assert.equal(s.mode, "red"); });
  t("85% of the 5h window with only 20 min left does NOT throttle you (it resets before you hit the cap)", () => { const s = run([{ at: now - 6 * 3600e3, pct: 20 }, { at: now - 60e3, pct: 21 }], { used_percentage: 85, resets_at: Math.floor(now / 1000) + 1200 }); assert.equal(s.mode, "green"); });
  t("k is learned from the first real delta", () => { fs.writeFileSync(path.join(ud, "governor.json"), JSON.stringify({ mode: "green", calib: null, k: null, sessionsNotified: {}, history: [] })); const st = { calib: null, k: null }; gov.absorbSnapshot(st, { capturedAt: new Date(now - 7200e3).toISOString(), seven_day: { used_percentage: 50, resets_at: resets } }, 10); gov.absorbSnapshot(st, { capturedAt: new Date(now).toISOString(), seven_day: { used_percentage: 52, resets_at: resets } }, 11); assert.ok(Math.abs(st.k - 2) < 1e-9, String(st.k)); });
  delete process.env.USAGE_MAX_HOME;
}
console.log(`${n} passing`);
