// Tests for the Windows launchers in install/kit (*.cmd). They need cmd.exe, so they run only on Windows (CI has a Windows job); elsewhere this file says so and passes.
// `node test/win.mjs WIN-3` runs just that block. Every launcher runs against a stand-in "usage-max" folder, so nothing real is installed or changed.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kit = path.join(root, "..", "install", "kit");
const only = process.argv[2] || null; let n = 0;
if (process.platform !== "win32") { console.log("skipped: the launcher tests need Windows (cmd.exe); the Windows CI job runs them"); process.exit(0); }
const tmp = (p = "umw-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };

// A copy of the launchers next to a stand-in usage-max (and Codex installer) that only records how it was called.
function sandbox({ withFiles = true, installExit = 0 } = {}) {
  const dir = tmp(), out = path.join(dir, "args.json");
  for (const f of fs.readdirSync(kit).filter((x) => x.endsWith(".cmd"))) fs.copyFileSync(path.join(kit, f), path.join(dir, f));
  if (withFiles) {
    fs.mkdirSync(path.join(dir, "usage-max", "scripts"), { recursive: true }); fs.mkdirSync(path.join(dir, "usage-max", "codex", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "usage-max", "scripts", "usage-max.mjs"), 'import fs from "node:fs"; fs.writeFileSync(process.env.STUB_OUT, JSON.stringify(process.argv.slice(2)));\n');
    fs.writeFileSync(path.join(dir, "usage-max", "codex", "scripts", "install.mjs"), `import fs from "node:fs"; fs.writeFileSync(process.env.STUB_OUT, "installed"); process.exit(${installExit});\n`);
  }
  return { dir, out, profile: path.join(dir, "profile") };
}
// Runs one launcher with the given keyboard input (one line per answer); returns { status, text, args } where args is what the stand-in saw (or null).
function launch(sb, file, input = "", env = {}) {
  fs.mkdirSync(sb.profile, { recursive: true });
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${path.join(sb.dir, file)}"`], { input, encoding: "utf8", windowsVerbatimArguments: true, cwd: sb.dir, timeout: 60000, env: { ...process.env, STUB_OUT: sb.out, USERPROFILE: sb.profile, ...env } });
  let args = null; try { args = JSON.parse(fs.readFileSync(sb.out, "utf8")); } catch (e) { args = null; }
  return { status: r.status, text: `${r.stdout || ""}${r.stderr || ""}`, args };
}

await t("WIN-1", "4-CALIBRATE-CLAUDE passes a normal percent and reset time through intact", async () => {
  const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", "67\nOct 11 2026 11:00 AM\n\n");
  assert.equal(r.status, 0, r.text); assert.deepEqual(r.args, ["budget", "calibrate", "67", "--resets", "Oct 11 2026 11:00 AM"]);
  const dec = launch(sandbox(), "4-CALIBRATE-CLAUDE.cmd", "4.5\nOct 11 2026 11:00 AM\n\n"); assert.deepEqual(dec.args && dec.args[2], "4.5", "a decimal percent is fine");
});

await t("WIN-2", "4-CALIBRATE-CLAUDE never lets typed text run as a command", async () => {
  for (const pct of ["67&echo pwned>pwned.txt", "67 & calc", "%PATH%", "67|dir", "67^", "abc", "", "67%", "6 7"]) {
    const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", `${pct}\nOct 11 2026 11:00 AM\n\n`);
    assert.equal(r.args, null, `percent ${JSON.stringify(pct)} must be refused, the tool was called with ${JSON.stringify(r.args)}`); assert.notEqual(r.status, 0, pct); assert.ok(!fs.existsSync(path.join(sb.dir, "pwned.txt")), "nothing was run: " + pct);
  }
  // the reset text may contain command characters; they stay text (inside quotes, expanded late), and a quote mark is refused
  for (const rst of ["Oct 11 2026 11:00 AM & echo pwned>pwned.txt", "Oct 11 | dir", "Oct 11 2026 %PATH% 11:00", "Oct 11 2026 11:00 AM!", "Oct 11 ^ 2026 11:00"]) {
    const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", `67\n${rst}\n\n`);
    assert.ok(!fs.existsSync(path.join(sb.dir, "pwned.txt")), "nothing was run: " + rst);
    if (r.args) assert.equal(r.args[4], rst, "arrives as one intact argument: " + rst);
  }
  const q = sandbox(), rq = launch(q, "4-CALIBRATE-CLAUDE.cmd", '67\nOct 11 "2026" 11:00 AM\n\n'); assert.equal(rq.args, null, "a quote mark is refused"); assert.notEqual(rq.status, 0);
});

await t("WIN-3", "launchers say so plainly when Node.js is missing", async () => {
  const system = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
  for (const f of ["2-INSTALL-CODEX.cmd", "3-CHECK-EVERYTHING.cmd", "4-CALIBRATE-CLAUDE.cmd"]) {
    const sb = sandbox(), r = launch(sb, f, "\n", { PATH: system, Path: system });
    assert.match(r.text, /Node\.js was not found/, f + ": " + r.text); assert.equal(r.status, 1, f); assert.equal(r.args, null, f + " ran nothing");
  }
});

await t("WIN-4", "launchers say so plainly when the usage-max files are not next to them", async () => {
  for (const f of ["2-INSTALL-CODEX.cmd", "3-CHECK-EVERYTHING.cmd", "4-CALIBRATE-CLAUDE.cmd"]) {
    const sb = sandbox({ withFiles: false }), r = launch(sb, f, "\n");
    assert.match(r.text, /Could not find the usage-max files/, f + ": " + r.text); assert.equal(r.status, 1, f);
  }
});

await t("WIN-5", "2-INSTALL-CODEX reports success and failure of the installer honestly", async () => {
  const ok = launch(sandbox(), "2-INSTALL-CODEX.cmd", "\n"); assert.equal(ok.status, 0, ok.text); assert.match(ok.text, /DONE with the Codex install/); assert.equal(ok.args, "installed");
  const bad = launch(sandbox({ installExit: 1 }), "2-INSTALL-CODEX.cmd", "\n"); assert.equal(bad.status, 1, bad.text); assert.match(bad.text, /did not finish/); assert.doesNotMatch(bad.text, /DONE with the Codex install/);
});

await t("WIN-6", "3-CHECK-EVERYTHING runs doctor --fix", async () => {
  const r = launch(sandbox(), "3-CHECK-EVERYTHING.cmd", "\n"); assert.equal(r.status, 0, r.text); assert.deepEqual(r.args, ["doctor", "--fix"]);
});

await t("WIN-7", "launchers find the copy Claude installed (newest version folder) when the zip folder has none", async () => {
  const sb = sandbox({ withFiles: false }), cache = path.join(sb.profile, ".claude", "plugins", "cache", "eric-plugins", "usage-max");
  for (const [v, age] of [["0.18.0", 5], ["0.19.1", 0]]) {
    const d = path.join(cache, v, "scripts"); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, "usage-max.mjs");
    fs.writeFileSync(f, `import fs from "node:fs"; fs.writeFileSync(process.env.STUB_OUT, JSON.stringify(["${v}", ...process.argv.slice(2)]));\n`);
    const when = new Date(Date.now() - age * 864e5); fs.utimesSync(d, when, when); fs.utimesSync(path.join(cache, v), when, when); fs.utimesSync(f, when, when);
  }
  const r = launch(sb, "3-CHECK-EVERYTHING.cmd", "\n"); assert.equal(r.status, 0, r.text); assert.deepEqual(r.args, ["0.19.1", "doctor", "--fix"], "the newest installed copy is used");
});

console.log(`${n} passing`);
