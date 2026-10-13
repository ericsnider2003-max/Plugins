// Tests for the streaming trimmer (BUG-047, blocks a..h). `node test/fix-s.mjs BUG-047c` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawn, spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umx-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const POSIX = process.platform !== "win32";
const COPIES = [["claude", "scripts/trim.mjs"], ["codex", "codex/scripts/trim.mjs"]];
const lines = (a, b, f = (i) => "line " + i) => Array.from({ length: b - a }, (_, i) => f(a + i) + "\n").join("");
const envFor = (home, extra = {}) => ({ ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a running child whose stdout we collect; .exit resolves { code, sig } when it is gone
const watch = (args, opt = {}) => { const c = spawn(process.execPath, args, opt); const w = { c, out: "" }; c.stdout.on("data", (d) => { w.out += d; }); w.exit = new Promise((r) => c.on("close", (code, sig) => r({ code, sig }))); return w; };
const until = async (w, re, ms = 10000) => { const t0 = Date.now(); while (!re.test(w.out) && Date.now() - t0 < ms) await sleep(40); return re.test(w.out); };
const savedFiles = (home) => { const d = path.join(home, ".usage-max", "full-output"); try { return fs.readdirSync(d).map((x) => path.join(d, x)); } catch (e) { return []; } };
const norm = (s) => s.replace(/\r\n/g, "\n");

await t("BUG-047a", "a command that finishes gets the same trimmed text as the old all-at-the-end algorithm (head 30, error lines, tail 60, same markers)", async () => {
  const { trim } = await imp("scripts/trim.mjs");
  const mk = (len, errEvery, eol, endNl) => Array.from({ length: len }, (_, i) => (errEvery && i % errEvery === 7 ? `FAILED test ${i}` : `line ${i}`)).join(eol) + (endNl ? eol : "");
  const cases = [mk(400, 0, "\n", true), mk(400, 97, "\n", true), mk(400, 5, "\n", true), mk(300, 40, "\r\n", true), mk(250, 0, "\n", false), mk(111, 9, "\n", false), mk(2000, 3, "\r\n", false)];
  for (const [label, script] of COPIES) {
    for (const [k, text] of cases.entries()) {
      const home = tmp(), want = trim(text);
      const r = spawnSync(process.execPath, [path.join(root, script)], { input: text, encoding: "utf8", env: envFor(home), maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, `${label} case ${k}: ${r.stderr}`);
      assert.ok(want !== text, "the case is long enough to be trimmed"); const m = /\n\[usage-max: output was trimmed; the complete output is saved at ([^\]]+)\]$/.exec(r.stdout);
      assert.ok(m, `${label} case ${k}: pointer note at the end: ${JSON.stringify(r.stdout.slice(-200))}`);
      assert.equal(r.stdout.slice(0, m.index), want, `${label} case ${k}: same text as the old algorithm`);
      assert.equal(fs.readFileSync(m[1], "utf8"), text, `${label} case ${k}: the saved copy is the complete output (CRLF kept)`);
    }
  }
  // in-process, with the input cut at odd places (also inside a multi-byte character)
  const { StreamTrimmer } = await imp("scripts/trim.mjs"), text = mk(500, 11, "\n", true).replace("line 250", "line 250 é✗ü"); let got = "";
  const T = new StreamTrimmer({ write: (s) => { got += s; }, save: () => "/x/saved.txt" }); const b = Buffer.from(text); for (let p = 0; p < b.length; p += 7) T.push(b.subarray(p, p + 7));
  T.finish(); assert.equal(got + T.conclude(), trim(text) + "\n[usage-max: output was trimmed; the complete output is saved at /x/saved.txt]");
});

await t("BUG-047b", "short output is verbatim (up to head+tail+20 = 110 lines, counting the empty one after a final newline), with or without a final newline, LF or CRLF", async () => {
  const { StreamTrimmer } = await imp("scripts/trim.mjs");
  for (const text of [lines(0, 109), lines(0, 110).slice(0, -1), lines(0, 5), "", "no newline", "a\r\nb\r\n", lines(0, 109).replace(/\n/g, "\r\n")]) {
    let got = ""; const T = new StreamTrimmer({ write: (s) => { got += s; }, save: () => assert.fail("nothing to save for short output") }); T.push(Buffer.from(text)); const r = T.finish();
    assert.equal(got + T.conclude(), text); assert.equal(r.trimmed, false);
    for (const [, script] of COPIES) { const o = spawnSync(process.execPath, [path.join(root, script)], { input: text, encoding: "utf8", env: envFor(tmp()) }); assert.equal(o.stdout, text, script); }
  }
  let got = ""; const T = new StreamTrimmer({ write: (s) => { got += s; }, save: () => "/x/s.txt" }); T.push(Buffer.from(lines(0, 110))); T.finish(); assert.match(got, /\[usage-max: 21 lines trimmed\]/, "one more than 110 is trimmed");
});

await t("BUG-047c", "partial output is shown while the command runs: first lines at once, held lines after 1 s of quiet (or ~10 s of age), unfinished lines too", async () => {
  const { StreamTrimmer } = await imp("scripts/trim.mjs");
  let clock = 1000, got = ""; const T = new StreamTrimmer({ now: () => clock, write: (s) => { got += s; }, save: () => "/x/s.txt" });
  T.push(Buffer.from(lines(0, 20))); assert.equal(got, lines(0, 20), "the first lines are printed the moment they arrive");
  T.push(Buffer.from(lines(20, 70))); assert.equal(got, lines(0, 30), "lines after the head are held");
  clock += 500; T.tick(clock); assert.equal(got, lines(0, 30), "not yet quiet for a second"); clock += 600; T.tick(clock); assert.equal(got, lines(0, 70), "after 1 s of quiet the held lines are shown");
  T.tick(clock + 5000); assert.equal(got, lines(0, 70), "and not shown twice");
  // steady output never goes quiet: the oldest held line is flushed at ~10 s
  let got2 = ""; clock = 0; const U = new StreamTrimmer({ now: () => clock, write: (s) => { got2 += s; }, save: () => "/x/s.txt" }); U.push(Buffer.from(lines(0, 50)));
  for (let i = 0; i < 9; i++) { clock += 1000; U.push(Buffer.from(lines(50 + i, 51 + i))); U.tick(clock); } assert.equal(got2, lines(0, 30), "9 s old and still not quiet: still held");
  clock += 1500; U.push(Buffer.from("x\n")); U.tick(clock); assert.match(got2, /line 58\nx\n$/, "10 s old: flushed even though output keeps coming");
  // a line that has no newline yet (a progress prompt) is shown on flush, and continues in place when it is finished
  let got3 = ""; clock = 0; const V = new StreamTrimmer({ now: () => clock, write: (s) => { got3 += s; } }); V.push(Buffer.from("Password: "));
  assert.equal(got3, "", "waits for the newline"); clock += 1500; V.tick(clock); assert.equal(got3, "Password: "); V.push(Buffer.from("ok\nnext\n")); V.finish(); assert.equal(got3, "Password: ok\nnext\n");
  // the real scripts: stdin that stays open
  const home = tmp();
  for (const [label, script] of COPIES) {
    const w = watch([path.join(root, script)], { env: envFor(home) }); w.c.stdin.write("partial one\n");
    assert.ok(await until(w, /partial one/), label + ": a short line appears while the input is still open, got " + JSON.stringify(w.out));
    w.c.stdin.write(lines(0, 300)); assert.ok(await until(w, /line 299\n/), label + ": the end of a burst appears once the command is quiet, got " + w.out.length + " chars");
    assert.match(w.out, /lines trimmed/); w.c.stdin.end(); const x = await w.exit; assert.equal(x.code, 0);
    assert.ok(!/complete output is saved/.test(w.out) || w.out.indexOf("line 299") < w.out.indexOf("complete output is saved"), "the pointer comes after the lines");
  }
});

await t("BUG-047d", "a killed command still shows its head and what it printed last, and the complete output is saved before dying (run-trimmed and the stdin filter)", async () => {
  const home = tmp(), env = envFor(home); const gen = path.join(home, "gen.mjs");
  fs.writeFileSync(gen, "for (let i = 0; i < 300; i++) console.log('row ' + i); console.log('ERROR middle'); console.log('last row'); setTimeout(() => {}, 60000);\n");
  // codex run-trimmed: the wrapper is killed while its command is still running
  const w = watch([path.join(root, "codex/scripts/run-trimmed.mjs"), "run", "node", "gen.mjs"], { cwd: home, env });
  assert.ok(await until(w, /row 29\n/), "the head appears at once, got " + JSON.stringify(w.out.slice(0, 80)));
  assert.ok(await until(w, /last row/), "the last lines appear after a second of quiet, got " + w.out.length + " chars");
  const seen = w.out; w.c.kill(); const x = await w.exit; if (POSIX) assert.equal(x.sig, "SIGTERM", "dies of the signal");
  assert.match(seen, /row 0\n/); assert.match(seen, /lines trimmed/);
  // the stdin filter, killed right after a burst (before the quiet time): the held lines are flushed and the copy saved first
  for (const [label, script] of COPIES) {
    const h2 = tmp(); const f = watch([path.join(root, script)], { env: envFor(h2) }); f.c.stdin.write(lines(0, 300).replace("line 150\n", "ERROR boom\n"));
    assert.ok(await until(f, /line 29\n/), label + ": head shown"); if (!POSIX) { f.c.kill(); await f.exit; continue; }
    f.c.kill("SIGTERM"); const y = await f.exit; assert.equal(y.sig, "SIGTERM", label + ": still exits by the signal");
    assert.match(f.out, /ERROR boom/); assert.match(f.out, /line 299\n/, label + ": SIGTERM flushes the held lines"); assert.match(f.out, /lines trimmed/);
    const m = /the complete output is saved at ([^\]]+)\]/.exec(f.out); assert.ok(m, label + ": the pointer to the saved copy is printed on a signal too: " + JSON.stringify(f.out.slice(-150)));
    assert.equal(fs.readFileSync(m[1], "utf8"), lines(0, 300).replace("line 150\n", "ERROR boom\n"), label + ": the saved copy is complete");
  }
  // SIGINT and SIGHUP behave the same
  if (POSIX) for (const sig of ["SIGINT", "SIGHUP"]) { const f = watch([path.join(root, "scripts/trim.mjs")], { env: envFor(tmp()) }); f.c.stdin.write(lines(0, 200)); assert.ok(await until(f, /line 29\n/)); f.c.kill(sig); const y = await f.exit; assert.equal(y.sig, sig); assert.match(f.out, /line 199\n/); }
  // input that simply ends because the writer was killed: finished normally, tail and pointer shown
  const g = watch([path.join(root, "scripts/trim.mjs")], { env: envFor(tmp()) }); g.c.stdin.write(lines(0, 300)); g.c.stdin.end(); const z = await g.exit; assert.equal(z.code, 0); assert.match(g.out, /line 299\n\n\[usage-max: output was trimmed/);
});

await t("BUG-047e", "nothing is lost: when the complete output cannot be saved, the whole output is printed (not saveable from the start) or the left-out lines are printed (save fails at the end)", async () => {
  const big = lines(0, 400), blocked = tmp(), notDir = path.join(blocked, "file"); fs.writeFileSync(notDir, "x");
  for (const [label, script] of COPIES) { const r = spawnSync(process.execPath, [path.join(root, script)], { input: big, encoding: "utf8", env: envFor(notDir), maxBuffer: 1 << 24 }); assert.equal(r.status, 0); assert.equal(r.stdout, big, label + ": USAGE_MAX_HOME is a file: everything is printed"); }
  const gen = path.join(blocked, "gen.mjs"); fs.writeFileSync(gen, "for (let i = 0; i < 400; i++) console.log('line ' + i);\n");
  const rt = spawnSync(process.execPath, [path.join(root, "codex/scripts/run-trimmed.mjs"), "run", "node", "gen.mjs"], { encoding: "utf8", cwd: blocked, env: envFor(notDir) });
  assert.equal(norm(rt.stdout), big, "run-trimmed prints everything when nothing can be saved"); assert.equal(rt.status, 0);
  // the save fails only at the end (disk full, permissions): the left-out lines are printed then
  const { StreamTrimmer } = await imp("scripts/trim.mjs"), text = lines(0, 400).replace("line 200\n", "WARNING careful\n");
  for (const fail of [() => null, () => { throw new Error("ENOSPC"); }]) {
    let got = ""; const T = new StreamTrimmer({ write: (s) => { got += s; }, save: fail }); for (let p = 0; p < text.length; p += 1000) T.push(Buffer.from(text.slice(p, p + 1000)));
    T.finish(); const note = T.conclude(); got += note; assert.match(note, /^\n\[usage-max: could not save the complete output; here are the lines that were left out\]\n/); assert.doesNotMatch(got, /is saved at/);
    const shown = new Set(got.split("\n")); for (let i = 0; i < 400; i++) assert.ok(shown.has(i === 200 ? "WARNING careful" : "line " + i), `line ${i} must be on screen`);
    const all = got.split("\n").filter((l) => /^line \d+$/.test(l)); const left = note.split("\n").filter((l) => /^line \d+$/.test(l)); assert.equal(left.length, 400 - 30 - 59 - 2, "exactly the lines that were not printed before (head 30, tail 59 + the empty last one, the warning and the line after it)");
    assert.ok(all.length >= 400 - 1);
  }
  // after the memory cap some lines cannot be shown or saved: said plainly
  let got = ""; const T = new StreamTrimmer({ rawCap: 4000, write: (s) => { got += s; }, save: () => null }); T.push(Buffer.from(lines(0, 1000))); T.finish(); const note = T.conclude();
  assert.match(note, /more lines were left out and could not be kept/); assert.match(note, /line 100\n/);
});

await t("BUG-047f", "memory stays bounded: a 120 MB stream succeeds, the saved copy stops at 64 MB and says so; a 520 MB stream and a 3 MB line do not fail", async () => {
  const home = tmp(), gen = path.join(home, "gen.mjs");
  fs.writeFileSync(gen, "const mb = +process.argv[2]; let sent = 0, i = 0; function go() { while (sent < mb * 1048576) { const s = Array.from({ length: 2000 }, () => 'L' + (i++) + ' build step output line with some padding text here ok done\\n').join(''); sent += s.length; if (!process.stdout.write(s)) { process.stdout.once('drain', go); return; } } } go();\n");
  const g = spawn(process.execPath, [gen, "120"], { stdio: ["ignore", "pipe", "inherit"] }), f = spawn(process.execPath, [path.join(root, "scripts/trim.mjs")], { stdio: ["pipe", "pipe", "inherit"], env: envFor(home) });
  g.stdout.pipe(f.stdin); let out = ""; f.stdout.on("data", (d) => { out += d; }); const code = await new Promise((r) => f.on("close", r));
  assert.equal(code, 0, "the filter does not fail on a 120 MB stream"); assert.ok(out.length < 20000, "output stays small: " + out.length); assert.match(out, /^L0 /); assert.match(out, /only the first 64 MB of 12\d MB is saved at /, out.slice(-300)); assert.match(out, /the rest was not kept\]$/);
  const files = savedFiles(home); assert.equal(files.length, 1); const st = fs.statSync(files[0]); assert.ok(st.size > 64 * 1048576 && st.size < 64 * 1048576 + 400, "64 MB plus a short note: " + st.size);
  fs.rmSync(files[0]);
  // far past 512 MB, in-process: no exception, bounded raw copy
  const { StreamTrimmer } = await imp("scripts/trim.mjs"); let outBytes = 0; const T = new StreamTrimmer({ rawCap: 1 << 20, write: (s) => { outBytes += s.length; }, save: () => "/x/s.txt" });
  const block = Buffer.from(lines(0, 2000, (i) => "row " + i + " " + "x".repeat(400))); const rounds = Math.ceil(520 * 1048576 / block.length);
  for (let i = 0; i < rounds; i++) T.push(block); const r = T.finish(); assert.ok(r.rawBytes > 512 * 1048576); assert.ok(T.rawSize <= 1 << 20, "raw copy capped: " + T.rawSize); assert.ok(outBytes < 100000, "printed " + outBytes); T.conclude();
  // one 3 MB line is cut at 1 MB for display with a note; the saved copy has it whole
  let got = ""; const U = new StreamTrimmer({ write: (s) => { got += s; }, save: () => "/x/s.txt" }); const huge = "y".repeat(3 * 1048576); U.push(Buffer.from("start\n" + huge.slice(0, 1 << 20))); U.push(Buffer.from(huge.slice(1 << 20) + "\nend\n")); U.finish();
  assert.ok(got.length < 1048576 + 400, "cut for display: " + got.length); assert.match(got, /this line is 3,145,728 characters long; cut after 1,048,576\]\nend\n/); assert.equal(U.rawText().length, "start\n".length + huge.length + "\nend\n".length);
});

await t("BUG-047g", "CRLF input: lines keep their CRLF, error lines are found, the final text matches the LF result", async () => {
  const { StreamTrimmer, trim } = await imp("scripts/trim.mjs"); const text = lines(0, 300, (i) => (i === 120 ? "npm ERROR code 1" : "line " + i)).replace(/\n/g, "\r\n");
  let got = ""; const T = new StreamTrimmer({ write: (s) => { got += s; }, save: () => "/x/s.txt" }); for (let p = 0; p < text.length; p += 13) T.push(Buffer.from(text.slice(p, p + 13))); T.finish();
  assert.equal(got, trim(text)); assert.match(got, /npm ERROR code 1\r\nline 121\r\n/); assert.ok(got.includes("line 299\r\n"));
  const o = spawnSync(process.execPath, [path.join(root, "codex/scripts/trim.mjs")], { input: text, encoding: "utf8", env: envFor(tmp()) }); assert.equal(o.stdout.replace(/\n\[usage-max: output was trimmed[^]*$/, ""), trim(text), "the script gives the same text; no line ending is changed");
});

await t("BUG-047h", "run-trimmed streams a finishing command: exit code is forwarded, short output is verbatim, long output is trimmed with a pointer", async () => {
  const home = tmp(), env = envFor(home); fs.writeFileSync(path.join(home, "s.mjs"), "console.log('a'); console.error('b'); process.exitCode = 3;\n"); fs.writeFileSync(path.join(home, "l.mjs"), "for (let i = 0; i < 400; i++) console.log('line ' + i); console.error('ERROR at the end');\n");
  const run = (f) => spawnSync(process.execPath, [path.join(root, "codex/scripts/run-trimmed.mjs"), "run", "node", f], { cwd: home, env, encoding: "utf8" });
  const a = run("s.mjs"); assert.equal(a.status, 3); assert.deepEqual(norm(a.stdout).split("\n").filter(Boolean).sort(), ["a", "b"]);
  const b = run("l.mjs"); assert.equal(b.status, 0); assert.match(b.stdout, /line 29\r?\n/); assert.match(b.stdout, /ERROR at the end/); assert.match(b.stdout, /lines trimmed/); assert.match(b.stdout, /output was trimmed; the complete output is saved at /); assert.ok(b.stdout.length < 4000);
  const m = /saved at ([^\]]+)\]/.exec(b.stdout); assert.deepEqual(norm(fs.readFileSync(m[1], "utf8")).split("\n").sort(), (lines(0, 400) + "ERROR at the end\n").split("\n").sort(), "the saved copy has every line (stdout and stderr arrive in either order)");
});

console.log(`${n} passing`);
