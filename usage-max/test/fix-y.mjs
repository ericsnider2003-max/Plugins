// Tests for `usage-max doctor --fix` (stale usage-max copies and leftover Codex config). `node test/fix-y.mjs FEAT-DOCTOR-3` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umy-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const RUNNING = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version;
const um = (args, home, extra = {}) => spawnSync(process.execPath, [path.join(root, "scripts/usage-max.mjs"), ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), PLUGIN_ROOT: "", CLAUDE_CODE_REMOTE: "", ...extra } });
const cg = (args, home) => spawnSync(process.execPath, [path.join(root, "codex/scripts/codex-governor.mjs"), ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), PLUGIN_ROOT: "" } });
const W = (f, c) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
const R = (f) => fs.readFileSync(f, "utf8");
const synced = (home, org, version, extra = {}) => { const d = path.join(home, ".claude", "plugins", "synced", org, "usage-max"); W(path.join(d, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "usage-max", version })); W(path.join(d, "skills", "x", "SKILL.md"), "skill of " + version); for (const [k, v] of Object.entries(extra)) W(path.join(d, k), v); return d; };
// every file under dir -> content (folders listed too), to prove "changed nothing"
const snap = (dir, base = dir, out = {}) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name), k = path.relative(base, p).replace(/\\/g, "/"); if (e.isDirectory()) { out[k + "/"] = ""; snap(p, base, out); } else out[k] = fs.readFileSync(p, "utf8"); } return out; };
// a fake "running" plugin root with a chosen version, for exact control in module-level tests
const fakeRoot = (home, version, sub = "running/usage-max") => { const d = path.join(home, sub); W(path.join(d, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "usage-max", version })); return d; };
const oldCopies = (home) => { const b = path.join(home, ".usage-max", "old-copies"); return fs.existsSync(b) ? fs.readdirSync(b) : []; };

await t("FEAT-DOCTOR-1", "doctor --fix moves an older uploaded copy aside (reversibly), leaves the running, newer and unreadable copies, and a second run changes nothing", async () => {
  const home = tmp(); const older = synced(home, "org_a", "0.1.0", { "notes.txt": "my note" }), newer = synced(home, "org_b", "99.0.0"), odd = synced(home, "org_c", "not-a-version");
  const before = snap(home);
  const dry = um(["doctor"], home); assert.match(dry.stdout, /FIX\s+old uploaded copy usage-max 0\.1\.0/); assert.match(dry.stdout, /run: usage-max doctor --fix/);
  assert.deepEqual(snap(home), before, "read-only doctor changes nothing in the user's home");
  const r1 = um(["doctor", "--fix"], home); assert.match(r1.stdout, /done moved old copy 0\.1\.0 to /, r1.stdout + r1.stderr);
  assert.equal(fs.existsSync(older), false, "the old folder left the plugins dir"); assert.ok(fs.existsSync(newer), "a newer copy stays"); assert.ok(fs.existsSync(odd), "a copy with an unreadable version stays");
  const [stampDir] = oldCopies(home); assert.equal(oldCopies(home).length, 1);
  const dest = path.join(home, ".usage-max", "old-copies", stampDir, "org_a-usage-max-0.1.0");
  assert.equal(R(path.join(dest, "notes.txt")), "my note", "everything inside came along"); assert.equal(JSON.parse(R(path.join(dest, ".claude-plugin", "plugin.json"))).version, "0.1.0");
  assert.match(R(path.join(home, ".usage-max", "old-copies", stampDir, "RESTORE.txt")), /org_a/);
  assert.ok(fs.existsSync(path.join(root, ".claude-plugin", "plugin.json")), "the running plugin is untouched");
  const mid = snap(home); const r2 = um(["doctor", "--fix"], home);
  assert.match(r2.stdout, /nothing to clean up in Claude Code/); assert.match(r2.stdout, /nothing to clean up in Codex/); assert.doesNotMatch(r2.stdout, /done moved/);
  const after = snap(home); for (const k of Object.keys(mid)) if (!/settings\.json|\.usage-max-backup|[\\/]usage-max[\\/]|^\.claude\/usage-max/.test(k)) assert.equal(after[k], mid[k], "unchanged by the second run: " + k);
  assert.equal(oldCopies(home).length, 1, "no second batch folder"); assert.ok(fs.existsSync(dest));
});

await t("FEAT-DOCTOR-2", "settings.json: only an older usage-max entry is switched off (one token, backup, locked), newer or unrelated names are not touched, and a second run is a no-op", async () => {
  const { cleanupClaude } = await imp("scripts/cleanup-old.mjs"); const home = tmp(), run = fakeRoot(home, "1.0.0"), sf = path.join(home, ".claude", "settings.json");
  synced(home, "org_a", "0.5.0");
  const eol = "\r\n"; const txt = ['{', '    "model": "keep-me",', '    "enabledPlugins": {', '        "usage-max@synced": true,', '        "usage-max-extra@synced": true,', '        "usage-tracker@x": true,', '        "my-usage-max@y": true,', '        "other@synced": true', '    },', '    "env": { "A": "1" }', '}', ''].join(eol);
  W(sf, txt);
  const dry = cleanupClaude({ home, root: run, fix: false }); assert.equal(dry.found, 2, "one folder and one settings key"); assert.equal(R(sf), txt, "dry run writes nothing");
  const r = cleanupClaude({ home, root: run, fix: true }); assert.equal(r.done, 2, r.lines.join("\n"));
  assert.equal(R(sf), txt.replace('"usage-max@synced": true', '"usage-max@synced": false'), "exactly one token changed; CRLF, indent and the rest are byte-identical");
  const baks = fs.readdirSync(path.dirname(sf)).filter((f) => f.startsWith("settings.json.usage-max-backup")); assert.ok(baks.length >= 1, "backup exists");
  for (const b of baks) assert.equal(R(path.join(path.dirname(sf), b)), txt, "the backup holds the original");
  assert.ok(r.lines.some((l) => /backup at /.test(l)));
  const files = snap(home); const r2 = cleanupClaude({ home, root: run, fix: true }); assert.equal(r2.done, 0); assert.match(r2.lines.join("\n"), /nothing to clean up/); assert.deepEqual(snap(home), files, "second run changes nothing, not even a new backup");
  // a copy as new as, or newer than, the running one is never touched
  const home2 = tmp(), run2 = fakeRoot(home2, "1.0.0"); synced(home2, "org_a", "1.0.0"); synced(home2, "org_b", "2.0.0"); W(path.join(home2, ".claude", "settings.json"), '{"enabledPlugins":{"usage-max@synced":true}}'); const s2 = snap(home2);
  const r3 = cleanupClaude({ home: home2, root: run2, fix: true }); assert.equal(r3.found, 0); assert.deepEqual(snap(home2), s2);
});

await t("FEAT-DOCTOR-3", "settings.json: keys resolved through installed_plugins.json are disabled only when strictly older; the running copy's own key and unrelated plugins are never touched", async () => {
  const { cleanupClaude, planClaude } = await imp("scripts/cleanup-old.mjs"); const home = tmp();
  const run = fakeRoot(home, "2.0.0", path.join(".claude", "plugins", "cache", "eric-plugins", "usage-max", "2.0.0"));
  const inst = (v) => ({ installPath: path.join(home, ".claude", "plugins", "cache", "oldmkt", "usage-max", v), version: v });
  W(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "usage-max@eric-plugins": [{ installPath: run, version: "2.0.0" }], "usage-max@oldmkt": [inst("0.9.0")], "usage-max@newmkt": [inst("3.0.0")], "usage-max@nover": [{ installPath: "x" }], "usage-max@same": [inst("2.0.0")], "usage-mixed@oldmkt": [inst("0.1.0")] } }));
  const sf = path.join(home, ".claude", "settings.json");
  const doc = { enabledPlugins: { "usage-max@eric-plugins": true, "usage-max@oldmkt": true, "usage-max@newmkt": true, "usage-max@nover": true, "usage-max@same": true, "usage-max@unknown": true, "usage-mixed@oldmkt": true, "usage-max@off": false } };
  W(sf, JSON.stringify(doc, null, 2)); assert.deepEqual(planClaude({ home, root: run }).keys, ["usage-max@oldmkt"]);
  const r = cleanupClaude({ home, root: run, fix: true }); assert.equal(r.done, 1);
  const got = JSON.parse(R(sf)); assert.deepEqual(got, { enabledPlugins: { ...doc.enabledPlugins, "usage-max@oldmkt": false } });
  const s = snap(home); assert.equal(cleanupClaude({ home, root: run, fix: true }).done, 0); assert.deepEqual(snap(home), s);
  // invalid settings.json is left exactly as it is
  const home3 = tmp(), run3 = fakeRoot(home3, "2.0.0"); synced(home3, "o", "0.1.0"); W(path.join(home3, ".claude", "settings.json"), "{ not json"); cleanupClaude({ home: home3, root: run3, fix: true }); assert.equal(R(path.join(home3, ".claude", "settings.json")), "{ not json");
});

const CONF = (eol) => [
  '# my own settings, keep',
  'model = "gpt-x"   # trailing comment',
  'hooks.state."usage-max@synced:hooks/hooks.json:stop:0:0".trusted_hash = "z"',
  'notify = ["a", "b"]',
  '',
  '[plugins."github@openai-curated"]',
  'enabled = true',
  '',
  '[plugins."usage-max@local-desktop-app-uploads"]',
  'enabled = true',
  '',
  '[hooks.state."usage-max@local-desktop-app-uploads:hooks/hooks.json:session_start:0:0"]',
  'trusted_hash = "abc"',
  '',
  '# another plugin, keep',
  '[hooks.state."other@x:hooks/hooks.json:stop:0:0"]',
  'trusted_hash = "keep"',
  '',
  '[hooks.state."usage-max@eric-plugins:hooks/hooks.json:stop:0:0"]',
  'trusted_hash = "marketplace"',
  '',
  '[projects."C:\\\\code\\\\app"]',
  'trust_level = "trusted"',
  'list = [',
  '  "[hooks.state.\\"usage-max@synced:hooks/hooks.json:x\\"]",',
  ']',
  ''].join(eol);
const CONF_AFTER = (eol) => [
  '# my own settings, keep',
  'model = "gpt-x"   # trailing comment',
  'notify = ["a", "b"]',
  '',
  '[plugins."github@openai-curated"]',
  'enabled = true',
  '',
  '# another plugin, keep',
  '[hooks.state."other@x:hooks/hooks.json:stop:0:0"]',
  'trusted_hash = "keep"',
  '',
  '[hooks.state."usage-max@eric-plugins:hooks/hooks.json:stop:0:0"]',
  'trusted_hash = "marketplace"',
  '',
  '[projects."C:\\\\code\\\\app"]',
  'trust_level = "trusted"',
  'list = [',
  '  "[hooks.state.\\"usage-max@synced:hooks/hooks.json:x\\"]",',
  ']',
  ''].join(eol);

for (const [id, label, eol] of [["FEAT-DOCTOR-4", "LF", "\n"], ["FEAT-DOCTOR-5", "CRLF", "\r\n"]]) {
  await t(id, `codex doctor --fix removes only the old uploaded copy's plugin and hook-trust entries from a ${label} config.toml (every other line byte-for-byte), with a backup, and is idempotent`, async () => {
    const home = tmp(), cf = path.join(home, ".codex", "config.toml"), hf = path.join(home, ".codex", "hooks.json");
    const hooks = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node "${path.join(home, ".usage-max-codex", "bin", "scripts", "codex-hook.mjs").replace(/\\/g, "/")}" stop` }] }] } });
    W(cf, CONF(eol)); W(hf, hooks);
    const dry = cg(["doctor"], home); assert.match(dry.stdout, /FIX\s+Codex still trusts Claude-only hooks/); assert.match(dry.stdout, /FIX\s+3 leftover Codex entries[\s\S]*run: usage-max doctor --fix/);
    assert.equal(R(cf), CONF(eol), "doctor without --fix changes nothing"); assert.equal(fs.readdirSync(path.dirname(cf)).length, 2);
    const r = cg(["doctor", "--fix"], home); assert.match(r.stdout, /done removed 3 leftover Codex entries of an old usage-max copy \(usage-max@synced, usage-max@local-desktop-app-uploads\); backup at /, r.stdout + r.stderr);
    assert.equal(R(cf), CONF_AFTER(eol)); assert.equal(R(hf), hooks, "hooks.json is not touched");
    assert.doesNotMatch(r.stdout, /FIX\s+Codex still trusts Claude-only hooks/, "the report reflects the cleaned file");
    const baks = fs.readdirSync(path.dirname(cf)).filter((f) => f.startsWith("config.toml.usage-max-backup")); assert.ok(baks.length >= 1);
    for (const b of baks) assert.equal(R(path.join(path.dirname(cf), b)), CONF(eol), "backup holds the original, bytes included");
    const s = snap(path.join(home, ".codex")); const r2 = cg(["doctor", "--fix"], home); assert.match(r2.stdout, /nothing to clean up in Codex/); assert.deepEqual(snap(path.join(home, ".codex")), s, "second run changes nothing");
  });
}

await t("FEAT-DOCTOR-6", "codex cleanup keeps the current desktop upload, marketplace entries and unrelated plugins whose name contains 'usage'", async () => {
  const { cleanupCodex, removeLeftovers } = await imp("codex/scripts/cleanup.mjs"); const home = tmp(), ch = path.join(home, ".codex"), cf = path.join(ch, "config.toml");
  const keep = ['[plugins."usage-max@local-desktop-app-uploads"]', 'enabled = true', '', '[hooks.state."usage-max@local-desktop-app-uploads:codex/hooks.json:stop:0:0"]', 'trusted_hash = "codex"', '',
    '[plugins."usage-tracker@local-desktop-app-uploads"]', 'enabled = true', '', '[hooks.state."usage-tracker@local-desktop-app-uploads:hooks/hooks.json:stop:0:0"]', 'trusted_hash = "x"', '',
    '[plugins."my-usage-max@synced"]', 'enabled = true', '', '[hooks.state."my-usage-max@synced:hooks/hooks.json:stop:0:0"]', 'trusted_hash = "y"', '',
    '[plugins."usage-max@eric-plugins"]', 'enabled = true', '', '[hooks.state."usage-max@eric-plugins:hooks/hooks.json:stop:0:0"]', 'trusted_hash = "m"', ''].join("\n");
  W(cf, keep); assert.equal(removeLeftovers(keep).removed.length, 0); assert.equal(cleanupCodex({ codexHome: ch, fix: true }).removed, 0); assert.equal(R(cf), keep); assert.equal(fs.readdirSync(ch).length, 1, "no backup, no write when there is nothing to remove");
  // the same upload name ALSO has Claude-only trust: only the Claude-only table goes; the plugin table stays because Codex-specific trust still points at it
  const mixed = keep + '\n[hooks.state."usage-max@local-desktop-app-uploads:hooks/hooks.json:session_start:0:0"]\ntrusted_hash = "old"\n';
  W(cf, mixed); const r = cleanupCodex({ codexHome: ch, fix: true }); assert.equal(r.removed, 1); assert.equal(R(cf), keep, "back to the kept entries only");
  assert.deepEqual(cleanupCodex({ codexHome: ch, fix: true }), { found: 0, removed: 0, names: [] });
  // a missing config.toml is not created; a config with no usage-max is untouched
  const h2 = tmp(); assert.equal(cleanupCodex({ codexHome: path.join(h2, ".codex"), fix: true }).removed, 0); assert.equal(fs.existsSync(path.join(h2, ".codex")), false);
});

await t("FEAT-DOCTOR-7", "usage-max doctor --fix and usage-max codex doctor --fix clean both sides in one go; a read-only run changes nothing", async () => {
  const home = tmp(), cf = path.join(home, ".codex", "config.toml");
  synced(home, "org_a", "0.2.0"); W(cf, CONF("\n")); W(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "usage-max@synced": true, "keep@me": true } }, null, 2));
  const s0 = snap(home); const dry = um(["doctor"], home); assert.deepEqual(snap(home), s0, "read-only: no file, folder or backup is created"); assert.match(dry.stdout, /run: usage-max doctor --fix/);
  const r = um(["doctor", "--fix"], home); assert.match(r.stdout, /done moved old copy 0\.2\.0 to /, r.stdout); assert.match(r.stdout, /done disabled 1 older usage-max plugin entry in settings\.json \(usage-max@synced\); backup at /); assert.match(r.stdout, /done removed 3 leftover Codex entries/);
  assert.equal(JSON.parse(R(path.join(home, ".claude", "settings.json"))).enabledPlugins["usage-max@synced"], false); assert.equal(JSON.parse(R(path.join(home, ".claude", "settings.json"))).enabledPlugins["keep@me"], true);
  assert.equal(R(cf), CONF_AFTER("\n"));
  const again = um(["doctor", "--fix"], home); assert.match(again.stdout, /nothing to clean up in Claude Code/); assert.match(again.stdout, /nothing to clean up in Codex/);
  const h2 = tmp(); W(path.join(h2, ".codex", "config.toml"), CONF("\r\n")); const c = um(["codex", "doctor", "--fix"], h2); assert.match(c.stdout, /done removed 3 leftover Codex entries/); assert.equal(R(path.join(h2, ".codex", "config.toml")), CONF_AFTER("\r\n"));
});

console.log(`${n} passing`);
