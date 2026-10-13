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
    fs.writeFileSync(path.join(dir, "usage-max", "scripts", "usage-max.mjs"), 'import fs from "node:fs"; fs.writeFileSync(process.env.STUB_OUT, JSON.stringify(process.argv.slice(2))); fs.writeFileSync(process.env.STUB_OUT + ".env", JSON.stringify({ pct: process.env.USAGE_MAX_PCT, resets: process.env.USAGE_MAX_RESETS }));\n');
    fs.writeFileSync(path.join(dir, "usage-max", "codex", "scripts", "install.mjs"), `import fs from "node:fs"; fs.writeFileSync(process.env.STUB_OUT, JSON.stringify("installed")); process.exit(${installExit});\n`);
  }
  return { dir, out, profile: path.join(dir, "profile") };
}
// Runs one launcher with the given keyboard input (one line per answer); returns { status, text, args } where args is what the stand-in saw (or null).
function launch(sb, file, input = "", env = {}) { // input uses CR LF line ends, like a real Enter key; it is given as a file because `set /p` reads a redirected file reliably
  fs.mkdirSync(sb.profile, { recursive: true });
  const inFile = path.join(sb.dir, "keys.txt"); fs.writeFileSync(inFile, input.replace(/\r?\n/g, "\r\n")); const fd = fs.openSync(inFile, "r");
  let r; try { r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${path.join(sb.dir, file)}"`], { stdio: [fd, "pipe", "pipe"], encoding: "utf8", windowsVerbatimArguments: true, cwd: sb.dir, timeout: 60000, env: { ...process.env, STUB_OUT: sb.out, USERPROFILE: sb.profile, ...env } }); } finally { fs.closeSync(fd); }
  let args = null; try { args = JSON.parse(fs.readFileSync(sb.out, "utf8")); } catch (e) { args = null; }
  let seen = null; try { seen = JSON.parse(fs.readFileSync(sb.out + ".env", "utf8")); } catch (e) { seen = null; }
  return { status: r.status, text: `${r.stdout || ""}${r.stderr || ""}`, args, seen };
}

await t("WIN-1", "4-CALIBRATE-CLAUDE hands a normal percent and reset time to usage-max as data", async () => {
  const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", "67\nOct 11 2026 11:00 AM\n\n");
  assert.equal(r.status, 0, r.text); assert.deepEqual(r.args, ["budget", "calibrate", "--from-env"]); assert.deepEqual(r.seen, { pct: "67", resets: "Oct 11 2026 11:00 AM" });
  const dec = launch(sandbox(), "4-CALIBRATE-CLAUDE.cmd", "4.5\nOct 11 2026 11:00 AM\n\n"); assert.equal(dec.seen && dec.seen.pct, "4.5", "a decimal percent is fine");
});

await t("WIN-2", "4-CALIBRATE-CLAUDE never lets typed text run as a command, whatever it contains", async () => {
  const nasty = ["67&echo pwned>pwned.txt", "67 & calc", "%PATH%", "67|dir", "67^", "a\"b", "!PATH!", "x) & (echo pwned>pwned.txt"];
  for (const text of nasty) {
    const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", `${text}\n${text}\n\n`);
    assert.ok(!fs.existsSync(path.join(sb.dir, "pwned.txt")), "nothing was run: " + text);
    assert.ok(r.seen && r.seen.pct === text && r.seen.resets === text, "arrives as plain text, unchanged (usage-max then refuses it): " + JSON.stringify(r.seen) + " <- " + text);
  }
  for (const miss of ["\n\n", "67\n\n", "\nOct 11 2026 11:00 AM\n\n"]) { const sb = sandbox(), r = launch(sb, "4-CALIBRATE-CLAUDE.cmd", miss); assert.equal(r.args, null, "nothing is called when an answer is missing"); assert.notEqual(r.status, 0); }
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
