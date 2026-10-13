// Tests for index-first memory suggestions from past sessions (session log, candidates, surfacing, search fallback).
// `node test/fix-m.mjs FEAT-MEM-3` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umm2-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const POSIX = process.platform !== "win32";
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();

// a sandbox: a fake home and a project (with .git so it is a project root) living in it
function box() {
  const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex"); delete process.env.USAGE_MAX_MEMORY_DIR;
  const proj = path.join(home, "work", "my-app"); fs.mkdirSync(path.join(proj, ".git"), { recursive: true }); fs.writeFileSync(path.join(proj, "README.md"), "# app\n");
  const env = { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), USAGE_MAX_HOST: "claude" }; delete env.USAGE_MAX_MEMORY_DIR;
  const tr = path.join(home, "transcript-s1.jsonl");
  return { home, proj, env, tr, cfgFile: path.join(home, ".claude", "usage-max", "config.json") };
}
const hook = (b, input, script = "hooks/memory.mjs", extra = []) => spawnSync(process.execPath, [path.join(root, script), ...extra], { input: JSON.stringify({ cwd: b.proj, session_id: "s1", transcript_path: b.tr, ...input }), env: b.env, encoding: "utf8" });
const stop = (b, extra = {}) => hook(b, { hook_event_name: "Stop", ...extra });
const start = (b, source = "startup", sid = "s2") => hook(b, { hook_event_name: "SessionStart", source, session_id: sid });
const cli = (b, args) => spawnSync(process.execPath, [path.join(root, "scripts/usage-max.mjs"), "memory", ...args], { cwd: b.proj, env: b.env, encoding: "utf8" });
const U = (text, time = new Date().toISOString(), extra = {}) => JSON.stringify({ type: "user", timestamp: time, sessionId: "s1", message: { role: "user", content: text }, ...extra }) + "\n";
const A = (blocks, time = new Date().toISOString()) => JSON.stringify({ type: "assistant", timestamp: time, message: { role: "assistant", model: "claude-sonnet-5-5", content: blocks } }) + "\n";
const logFile = (b) => { const d = path.join(b.home, ".usage-max", "session-log"); const f = fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith(".jsonl")) : []; return f.length ? path.join(d, f[0]) : null; };
const entries = (b) => { const f = logFile(b); return f ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };
const users = (b) => entries(b).filter((e) => e.type === "user").map((e) => e.text);
const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" });

await t("FEAT-MEM-1", "Stop logs only what the person typed, redacted, with the files edited; the log is private, outside the repo, and the repo stays git-clean", async () => {
  const b = box(); const tok = "ghp_" + "Ab1".repeat(12);
  const hasGit = git(b.proj, ["--version"]).status === 0;
  if (hasGit) { fs.rmSync(path.join(b.proj, ".git"), { recursive: true, force: true }); git(b.proj, ["init", "-q"]); git(b.proj, ["add", "-A"]); git(b.proj, ["-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-qm", "init"]); }
  fs.writeFileSync(b.tr, [
    U("Please rename the widget module to gizmo"),
    U("<system-reminder>\nSessionStart hook additional context: be nice\n</system-reminder>"),
    U([{ type: "text", text: "<system-reminder>injected</system-reminder>" }, { type: "text", text: "and also add a --dry-run flag" }]),
    JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "TOOL OUTPUT should never be logged" }] }, toolUseResult: {} }) + "\n",
    U("<command-name>/usage-max</command-name>\n<command-args>status</command-args>"),
    U("This session is being continued from a previous conversation that ran out of context. SUMMARY TEXT"),
    U("meta text injected by a hook", undefined, { isMeta: true }),
    U("subagent chatter", undefined, { isSidechain: true }),
    U(`my email is jane.doe@example.com and the token is ${tok}, please deploy`),
    A([{ type: "tool_use", name: "Edit", input: { file_path: path.join(b.proj, "src", "app.ts") } }, { type: "tool_use", name: "Write", input: { file_path: "docs/notes.md" } }, { type: "tool_use", name: "NotebookEdit", input: { notebook_path: path.join(b.proj, "nb.ipynb") } }, { type: "tool_use", name: "Edit", input: { file_path: path.join(os.tmpdir(), "outside-the-project.txt") } }, { type: "tool_use", name: "Bash", input: { command: "ls" } }]),
    U("x".repeat(500))
  ].join(""));
  const r = stop(b); assert.equal(r.status, 0); assert.equal(r.stdout, "", "the Stop hook stays silent");
  const us = users(b);
  assert.equal(us.length, 4, JSON.stringify(us));
  assert.equal(us[0], "Please rename the widget module to gizmo"); assert.equal(us[1], "and also add a --dry-run flag");
  const all = fs.readFileSync(logFile(b), "utf8");
  for (const bad of ["TOOL OUTPUT", "injected", "SUMMARY TEXT", "be nice", "/usage-max", "meta text", "subagent chatter", "jane.doe@example.com", tok]) assert.ok(!all.includes(bad), "must not be in the log: " + bad);
  assert.match(us[2], /\[email\]/); assert.match(us[2], /\[redacted\]/); assert.ok(us[3].length <= 200, "cut to 200 chars");
  const f = entries(b).find((e) => e.type === "files"); assert.deepEqual(f.files.sort(), ["docs/notes.md", "nb.ipynb", "src/app.ts"], "project-relative, only inside the project"); assert.ok(entries(b)[0].time && entries(b)[0].session === "s1");
  assert.ok(logFile(b).startsWith(path.join(b.home, ".usage-max", "session-log")) && /my-app-[0-9a-f]{8}\.jsonl$/.test(logFile(b)), logFile(b));
  assert.ok(!fs.existsSync(path.join(b.proj, ".usage-max")) && !fs.readdirSync(b.proj).some((x) => /session|usage/i.test(x)), "nothing written into the repo");
  if (hasGit) assert.equal(git(b.proj, ["status", "--porcelain"]).stdout.trim(), "", "the repo is git-clean");
  if (POSIX) { assert.equal(fs.statSync(logFile(b)).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(logFile(b))).mode & 0o777, 0o700); }
  const many = A(Array.from({ length: 45 }, (_, i) => ({ type: "tool_use", name: "Edit", input: { file_path: `f${i}.txt` } })));
  fs.appendFileSync(b.tr, many); stop(b); const names = entries(b).filter((e) => e.type === "files").flatMap((e) => e.files); assert.ok(names.length <= 30, "at most 30 files per session: " + names.length);
});

await t("FEAT-MEM-2", "a second Stop reads only the bytes added since the first", async () => {
  const b = box();
  fs.writeFileSync(b.tr, U("First request: use tabs everywhere please") + U("Second request about the parser"));
  stop(b); assert.equal(users(b).length, 2);
  // overwrite the already-read bytes with different text of the same length: a full re-read would log this "new" text
  const old = fs.readFileSync(b.tr, "utf8"); fs.writeFileSync(b.tr, old.replace("First request", "FIRST REQUEST").replace("parser", "PARSER"));
  fs.appendFileSync(b.tr, U("Third request arrives later") + U("Fourth one too"));
  stop(b); assert.deepEqual(users(b), ["First request: use tabs everywhere please", "Second request about the parser", "Third request arrives later", "Fourth one too"], "only the new requests were added");
  stop(b); assert.equal(users(b).length, 4, "an unchanged transcript adds nothing");
  fs.appendFileSync(b.tr, U("half written").slice(0, 30)); stop(b); assert.equal(users(b).length, 4, "a half-written last line is not consumed");
  fs.appendFileSync(b.tr, U("half written").slice(30)); stop(b); assert.equal(users(b).length, 5); assert.equal(users(b)[4], "half written", "and is read once it is complete");
  const S = await imp("scripts/sessionlog.mjs"); const big = path.join(b.home, "big.jsonl"); fs.writeFileSync(big, U("a".repeat(600 * 1024)) + U("after the huge line")); // chunked reading: a line bigger than a chunk
  const got = []; S.scanLines(big, 0, 1e9, (l) => { got.push(l.length); return false; }); assert.equal(got.length, 2);
});

await t("FEAT-MEM-3", "the log is capped at 2000 lines and entries older than 90 days are pruned when appending; a corrupt line is skipped", async () => {
  const b = box(); const d = path.join(b.home, ".usage-max", "session-log"); fs.mkdirSync(d, { recursive: true });
  const S = await imp("scripts/sessionlog.mjs"); const lf = S.logFileFor(S.projectRoot(b.proj), b.env); assert.equal(path.dirname(lf), d);
  const rows = []; for (let i = 0; i < 50; i++) rows.push(JSON.stringify({ type: "user", time: ago(120), session: "old", text: "ancient request " + i }));
  rows.push("{this is not json"); rows.push("");
  for (let i = 0; i < 2100; i++) rows.push(JSON.stringify({ type: "user", time: ago(1), session: "mid", text: "recent request " + i }));
  fs.writeFileSync(lf, rows.join("\n") + "\n");
  assert.equal(S.readLog(lf).length, 2150, "a corrupt line is skipped, the rest is read");
  fs.writeFileSync(b.tr, U("brand new request one") + U("brand new request two")); stop(b);
  const after = entries(b); assert.ok(after.length <= 2000, "capped: " + after.length); assert.equal(after.length, 2000);
  assert.ok(!after.some((e) => /ancient/.test(e.text)), "entries older than 90 days are gone"); assert.ok(!fs.readFileSync(lf, "utf8").includes("not json"), "the corrupt line is dropped on prune");
  assert.equal(after[after.length - 1].text, "brand new request two", "the newest survive"); assert.equal(after[0].text, "recent request " + (2100 + 2 - 2000));
  const st = JSON.parse(fs.readFileSync(lf.replace(/\.jsonl$/, ".state.json"), "utf8")); assert.equal(st.lines, 2000);
  const long = S.clipText("y".repeat(900)); assert.ok(long.length <= 200);
});

await t("FEAT-MEM-4", "memory off, or sessionLog off, writes nothing at all", async () => {
  for (const cfg of [{ memory: "off" }, { sessionLog: "off" }]) {
    const b = box(); fs.mkdirSync(path.dirname(b.cfgFile), { recursive: true }); fs.writeFileSync(b.cfgFile, JSON.stringify(cfg));
    fs.writeFileSync(b.tr, U("Let's use pnpm instead of npm in this repo")); const r = stop(b); assert.equal(r.status, 0);
    assert.equal(fs.existsSync(path.join(b.home, ".usage-max", "session-log")), false, "no session-log folder for " + JSON.stringify(cfg));
  }
  const b = box(); fs.writeFileSync(b.tr, U("Let's use pnpm instead of npm in this repo")); stop(b); assert.equal(users(b).length, 1, "and it does log when nothing is switched off");
});

await t("FEAT-MEM-5", "a failure while logging is swallowed with a recorded reason and never breaks the Stop hook", async () => {
  const b = box(); fs.mkdirSync(path.join(b.home, ".usage-max"), { recursive: true });
  fs.writeFileSync(path.join(b.home, ".usage-max", "session-log"), "i am a file, not a folder"); // the log folder cannot be created
  fs.writeFileSync(b.tr, U("hello there my friend")); const r = stop(b); assert.equal(r.status, 0); assert.equal(r.stdout, "");
  const S = await imp("scripts/sessionlog.mjs"); const res = S.recordStop({ cwd: b.proj, sessionId: "s9", transcript: b.tr, env: b.env }); assert.ok(res.error, "the reason is returned: " + JSON.stringify(res));
  assert.equal(S.recordStop({ cwd: b.proj, sessionId: "s9", transcript: path.join(b.home, "missing.jsonl"), env: b.env }).skipped, "transcript not readable");
});

await t("FEAT-MEM-6", "candidates: cue phrases are found, questions, secrets and personal data are not; deduplicated, ranked, max 8, one short line each", async () => {
  const S = await imp("scripts/session-suggest.mjs");
  const ok = ["Let's use pnpm instead of npm for installs.", "We decided to keep the API versioned under /v2.", "Never commit directly to main.", "Make sure to always run the linter before pushing.", "Going forward, tests live next to the code.", "We are using Postgres 16 for the database.", "The rule is: no default exports.", "Remember that the staging DB is read only on Fridays."];
  for (const s of ok) assert.ok(S.lineOf(s), "should be a candidate: " + s);
  for (const s of ["Should we use pnpm instead of npm?", "Let's use the new API, does that work?", "Never mind, I fixed it", "please fix the failing test", "My email is a.b@example.com and let's use it always", "The token is ghp_" + "a".repeat(36) + " and never share it"]) assert.equal(S.lineOf(s), null, "must not be a candidate: " + s);
  const long = S.lineOf("We decided that " + "the very long reason goes on and on ".repeat(10)); assert.ok(long.text.length <= 140, String(long.text.length));
  assert.equal(S.lineOf("ok, also never use var in this repo.").text, "never use var in this repo.", "filler is dropped");
  const b = box(); const M = await imp("scripts/memory.mjs"); const mem = M.init(b.proj); M.decide(mem, "package manager", "Use pnpm instead of npm for installs");
  const L = []; for (const s of ok) L.push(U(s)); L.push(U("Let's use pnpm instead of npm for installs.")); L.push(U("Should we always lint? Never sure.")); for (let i = 0; i < 6; i++) L.push(U(`Always use fixture number ${i} style for case ${i * 7}.`));
  fs.writeFileSync(b.tr, L.join("")); stop(b);
  const list = S.candidates(b.proj, { mem, env: b.env }); assert.ok(list.length <= 8 && list.length === 8, "max 8: " + list.length);
  assert.ok(!list.some((c) => /pnpm/i.test(c.text)), "already in decisions: not offered again");
  assert.ok(list.slice(0, 3).every((c) => c.strength === 3), "strongest cues rank first: " + list.map((c) => c.strength).join(","));
  assert.ok(list.every((c) => c.text.length <= 140 && /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  const r = cli(b, ["suggestions"]); assert.equal(r.status, 0); assert.match(r.stdout, /^\s*1\. \[\d{4}-\d{2}-\d{2}\] /m); assert.match(r.stdout, /Nothing has been saved/);
  assert.equal(M.readDecisions(mem).length, 1, "listing saved nothing"); assert.ok(!fs.existsSync(path.join(mem, "topics", "session-notes.md")));
  assert.match(cli(b, ["suggestions"]).stdout, /Nothing has been saved/);
  const empty = box(); assert.match(cli(empty, ["suggestions"]).stdout, /no session log for this project yet/);
});

await t("FEAT-MEM-7", "--accept 1,3 saves exactly those (decision for rules, session-notes for the rest) and nothing else; --dismiss hides for good", async () => {
  const b = box(); const M = await imp("scripts/memory.mjs"); const mem = M.init(b.proj); const S = await imp("scripts/session-suggest.mjs");
  fs.writeFileSync(b.tr, [U("We decided to use Fastify for the HTTP layer."), U("Never edit files under generated/ by hand."), U("Remember that the cron runs at 03:00 UTC."), U("Make sure to always bump the changelog."), U("Let's use zod for validation.")].join("")); stop(b);
  assert.equal(cli(b, ["suggestions", "--accept", "1"]).status, 1, "no list shown yet: refused"); // saves nothing
  assert.equal(M.readDecisions(mem).length, 0); assert.equal(M.listTopics(mem).length, 0);
  const shown = cli(b, ["suggestions"]).stdout; const lines = shown.split("\n").filter((l) => /^\s*\d+\. \[/.test(l)); assert.equal(lines.length, 5, shown);
  const pick = (i) => lines[i - 1].replace(/^\s*\d+\. \[[^\]]+\] /, "");
  const ok = cli(b, ["suggestions", "--accept", "1,3"]); assert.equal(ok.status, 0, ok.stdout); assert.match(ok.stdout, /saved #1/); assert.match(ok.stdout, /saved #3/);
  const decs = M.readDecisions(mem), tops = M.listTopics(mem), saved = decs.map((d) => d.value).join("\n") + tops.map((x) => x.text).join("\n");
  assert.ok(saved.includes(pick(1)) && saved.includes(pick(3)), "the picked lines are saved:\n" + saved);
  for (const i of [2, 4, 5]) assert.ok(!saved.includes(pick(i)), "not picked, not saved: " + pick(i));
  assert.equal(decs.length + tops.reduce((a, x) => a + x.text.split("\n").filter((l) => l.startsWith("- ")).length, 0), 2, "exactly two things saved");
  assert.ok(decs.every((d) => /from a session on \d{4}-\d{2}-\d{2}/.test(d.value)), "dated");
  const again = cli(b, ["suggestions", "--accept", "1"]); assert.match(again.stdout, /already handled/);
  const dis = cli(b, ["suggestions", "--dismiss", "2,4"]); assert.match(dis.stdout, /dismissed #2/); assert.equal(M.readDecisions(mem).length + M.listTopics(mem).length, decs.length + tops.length, "dismiss saves nothing");
  const next = S.candidates(b.proj, { mem, env: b.env }).map((c) => c.text); assert.ok(!next.includes(pick(2)) && !next.includes(pick(4)) && !next.includes(pick(1)), "dismissed and saved ones never reappear");
  fs.appendFileSync(b.tr, U("Make sure to always bump the changelog.")); stop(b);
  assert.ok(!S.candidates(b.proj, { mem, env: b.env }).some((c) => c.text === pick(4)), "even when it is asked again later");
  const l2 = cli(b, ["suggestions"]); assert.ok(!l2.stdout.includes(pick(4)));
  const rest = cli(b, ["suggestions", "--dismiss", "all"]); assert.equal(rest.status, 0); assert.match(cli(b, ["suggestions"]).stdout, /no suggestions/);
  const c = box(); const mem2 = M.init(c.proj); fs.writeFileSync(c.tr, [U("Never print secrets in logs."), U("We decided on UTC timestamps.")].join("")); stop(c);
  cli(c, ["suggestions"]); const all = cli(c, ["suggestions", "--accept", "all"]); assert.equal(all.status, 0); assert.equal(M.readDecisions(mem2).length, 2, "all saves every listed line");
});

await t("FEAT-MEM-8", "SessionStart injects exactly one short line, only for a fresh start, only when candidates exist, and only once per set", async () => {
  const b = box(); const M = await imp("scripts/memory.mjs"); const mem = M.init(b.proj);
  const ctxOf = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.additionalContext || "" : "");
  const quiet = start(b); assert.ok(!/possible project note/.test(ctxOf(quiet)), "silent when there are no candidates");
  fs.writeFileSync(b.tr, [U("Never commit .env files."), U("We decided on tabs."), U("Let's use vitest for tests.")].join("")); stop(b);
  const first = ctxOf(start(b)); const line = first.split("\n").find((l) => /possible project note/.test(l)); assert.ok(line, first);
  assert.ok(line.length <= 420, line.length + ": " + line); assert.match(line, /^usage-max: 3 possible project notes/); assert.match(line, /show memory suggestions/); assert.match(line, /nothing (is )?saved (unless|without) (you )?approv/); assert.match(line, /memory-cli\.mjs" suggestions/);
  assert.equal(first.split("possible project note").length, 2, "exactly one line");
  assert.ok(!/possible project note/.test(ctxOf(start(b))), "not repeated for the same set");
  fs.appendFileSync(b.tr, U("Always run the formatter.")); stop(b);
  assert.match(ctxOf(start(b)), /4 possible project notes/, "a changed set is announced again");
  fs.appendFileSync(b.tr, U("Don't ever force-push to main.")); stop(b);
  for (const source of ["resume", "compact"]) assert.ok(!/possible project note/.test(ctxOf(start(b, source))), "not on " + source);
  assert.match(ctxOf(start(b, "clear")), /5 possible project notes/, "a cleared session counts as fresh");
  // the command in the line really runs
  const cmd = line.match(/Run: (node "[^"]+" suggestions)/)[1].replace(/^node "/, "").replace(/" suggestions$/, "");
  const run = spawnSync(process.execPath, [cmd, "suggestions"], { cwd: b.proj, env: b.env, encoding: "utf8" }); assert.equal(run.status, 0); assert.match(run.stdout, /1\. \[/);
  // switched off
  fs.mkdirSync(path.dirname(b.cfgFile), { recursive: true });
  for (const cfg of [{ memorySuggestions: "off" }, { memory: "off" }]) { fs.writeFileSync(b.cfgFile, JSON.stringify(cfg)); fs.rmSync(path.join(b.home, ".usage-max", "memory-suggestions"), { recursive: true, force: true }); assert.ok(!/possible project note/.test(ctxOf(start(b))), "silent with " + JSON.stringify(cfg)); }
  const noMem = box(); fs.writeFileSync(noMem.tr, U("Never commit .env files.")); stop(noMem); assert.ok(!/possible project note/.test(ctxOf(start(noMem))), "silent without project memory");
});

await t("FEAT-MEM-9", "search finds a request that was NOT in the suggestion list, in the log and in the transcripts, with snippet and path; redacted, newest first", async () => {
  const b = box(); const M = await imp("scripts/memory.mjs"); const mem = M.init(b.proj); M.decide(mem, "widget naming", "the gizmo module owns widgets");
  fs.writeFileSync(b.tr, U("We should rename the gizmo module because jane.doe@example.com asked, token ghp_" + "Zz9".repeat(12), ago(3)) + U("Never push on Fridays", ago(2)) + U("unrelated chatter", ago(1)));
  stop(b);
  const S = await imp("scripts/session-suggest.mjs"); assert.ok(!S.candidates(b.proj, { mem, env: b.env }).some((c) => /gizmo/.test(c.text)), "the gizmo request is not a suggestion");
  const home = b.home; const tdir = path.join(home, ".claude", "projects", b.proj.replace(/[^A-Za-z0-9]/g, "-")); fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, "abc.jsonl"), U("Earlier session: why is the gizmo slow", ago(10)) + A([{ type: "tool_use", name: "Bash", input: { command: "grep gizmo" } }], ago(10)) + A([{ type: "text", text: "Renamed the gizmo module across the repo." }], ago(9)) + JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "gizmo TOOL RESULT" }] } }) + "\n");
  const r = cli(b, ["search", "gizmo"]); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /session log \(you asked\)/); assert.match(r.stdout, /\.memory decision/); assert.match(r.stdout, /transcript \(you\)/); assert.match(r.stdout, /transcript \(assistant\)/);
  assert.match(r.stdout, /file: .*abc\.jsonl/); assert.match(r.stdout, /file: .*my-app-[0-9a-f]{8}\.jsonl/);
  assert.ok(!/TOOL RESULT/.test(r.stdout) && !r.stdout.includes("jane.doe@example.com") && !r.stdout.includes("ghp_"), "tool output is not searched; private data is redacted");
  const order = [...r.stdout.matchAll(/^\[(\d{4}-\d{2}-\d{2})\]/gm)].map((m) => m[1]); assert.deepEqual(order, [...order].sort().reverse(), "newest first");
  for (const snip of r.stdout.matchAll(/^  "(.*)"$/gm)) assert.ok(snip[1].length <= 160, "snippet <= 160: " + snip[1].length);
  const none = cli(b, ["search", "zebra", "quantum"]); assert.match(none.stdout, /nothing found for "zebra quantum"/); assert.match(none.stdout, /session log/); assert.match(none.stdout, /\.memory/); assert.match(none.stdout, /Claude transcripts/);
  assert.match(cli(b, ["search"]).stdout, /usage:/);
  // old transcripts (older than 60 days) are not read
  const old = path.join(tdir, "old.jsonl"); fs.writeFileSync(old, U("ancient talk about the unicorn module")); const past = new Date(Date.now() - 90 * 864e5); fs.utimesSync(old, past, past);
  assert.match(cli(b, ["search", "unicorn"]).stdout, /nothing found/);
});

await t("FEAT-MEM-10", "search never prints more than 20 hits or 4 KB, reads big transcripts in chunks, and a corrupt log line does not stop it", async () => {
  const b = box(); const tdir = path.join(b.home, ".claude", "projects", b.proj.replace(/[^A-Za-z0-9]/g, "-")); fs.mkdirSync(tdir, { recursive: true });
  const rows = []; for (let i = 0; i < 60; i++) rows.push(U(`request ${i} about the ledger module ${"detail ".repeat(60)}`, ago(5 - i / 20)));
  rows.push(U("q".repeat(5 * 1024 * 1024) + " ledger")); // a 5 MB single line inside the transcript
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(tdir, `big${i}.jsonl`), rows.join(""));
  fs.writeFileSync(b.tr, U("the ledger needs a cleanup")); stop(b);
  const lf = logFile(b); fs.appendFileSync(lf, "{corrupt line\n");
  const r = cli(b, ["search", "ledger"]); assert.equal(r.status, 0, r.stderr); assert.ok(Buffer.byteLength(r.stdout) <= 4096, "4 KB cap: " + Buffer.byteLength(r.stdout));
  const hits = [...r.stdout.matchAll(/^\[\d{4}-\d{2}-\d{2}\]/gm)].length; assert.ok(hits >= 1 && hits <= 20, "hits: " + hits); assert.match(r.stdout, /more hits? not shown/);
  assert.match(r.stdout, /ledger needs a cleanup/, "the corrupt line did not stop the log search");
  const Q = await imp("scripts/session-search.mjs"); const small = Q.search(["ledger"], { cwd: b.proj, env: b.env, maxBytes: 600 }); assert.ok(Buffer.byteLength(small.text) <= 600);
});

await t("FEAT-MEM-11", "the Codex Stop hook logs requests and edited files from the rollout file, and respects the off switches", async () => {
  const b = box(); const rollDir = path.join(b.home, ".codex", "sessions", "2026", "10", "13"); fs.mkdirSync(rollDir, { recursive: true });
  const roll = path.join(rollDir, "rollout-2026-10-13T00-00-00-cs1.jsonl"); const ev = (type, payload, extra = {}) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload, ...extra }) + "\n";
  fs.writeFileSync(roll, ev("event_msg", { type: "user_message", message: "Let's use ruff instead of flake8" }) + ev("event_msg", { type: "user_message", message: "<environment_context>cwd</environment_context>" }) + ev("response_item", { type: "message", role: "user", content: [{ text: "Let's use ruff instead of flake8" }] }) + ev("response_item", { type: "function_call", name: "apply_patch", arguments: "*** Begin Patch\n*** Update File: " + path.join(b.proj, "pyproject.toml").replace(/\\/g, "\\\\") + "\n*** End Patch" }));
  const codexStop = () => spawnSync(process.execPath, [path.join(root, "codex/scripts/codex-hook.mjs"), "Stop"], { input: JSON.stringify({ hook_event_name: "Stop", cwd: b.proj, session_id: "cs1", transcript_path: roll }), env: b.env, encoding: "utf8" });
  assert.equal(codexStop().status, 0); assert.deepEqual(users(b), ["Let's use ruff instead of flake8"], JSON.stringify(entries(b)));
  const fe = entries(b).find((e) => e.type === "files"); assert.ok(fe && fe.files.includes("pyproject.toml"), JSON.stringify(entries(b)));
  fs.appendFileSync(roll, ev("event_msg", { type: "user_message", message: "Always run the type checker" })); codexStop(); assert.equal(users(b).length, 2);
  const off = box(); fs.mkdirSync(path.join(off.home, ".usage-max-codex"), { recursive: true }); fs.writeFileSync(path.join(off.home, ".usage-max-codex", "config.json"), JSON.stringify({ sessionLog: "off" }));
  const od = path.join(off.home, ".codex", "sessions", "2026", "10", "13"); fs.mkdirSync(od, { recursive: true }); const r2 = path.join(od, "rollout-x-cs1.jsonl"); fs.writeFileSync(r2, ev("event_msg", { type: "user_message", message: "Never do this" }));
  spawnSync(process.execPath, [path.join(root, "codex/scripts/codex-hook.mjs"), "Stop"], { input: JSON.stringify({ hook_event_name: "Stop", cwd: off.proj, session_id: "cs1", transcript_path: r2 }), env: off.env, encoding: "utf8" });
  assert.equal(fs.existsSync(path.join(off.home, ".usage-max", "session-log")), false, "off: nothing written");
  const sync = await imp("codex/scripts/sync.mjs"); assert.ok(sync.SHARED_FILES.includes("sessionlog.mjs"), "the stable Codex copy gets the log code too");
});

await t("FEAT-MEM-12", "the always-loaded memory block does not grow, and every new write stays outside .memory", async () => {
  const b = box(); const M = await imp("scripts/memory.mjs"); const mem = M.init(b.proj); M.decide(mem, "k", "value one"); M.addFact(mem, "area", "a fact about the area");
  const before = M.loadBlock(mem), tree = () => fs.readdirSync(mem, { recursive: true }).sort().join(",");
  const t0 = tree(); fs.writeFileSync(b.tr, U("Never commit secrets.") + U("Let's use sqlite for tests.")); stop(b); start(b); cli(b, ["suggestions"]); cli(b, ["search", "sqlite"]);
  assert.equal(M.loadBlock(mem), before, "loadBlock is byte-identical"); assert.equal(tree(), t0, ".memory gained no file until you accept something");
  const sc = fs.readFileSync(path.join(root, "scripts", "session-suggest.mjs"), "utf8") + fs.readFileSync(path.join(root, "scripts", "session-search.mjs"), "utf8") + fs.readFileSync(path.join(root, "scripts", "sessionlog.mjs"), "utf8");
  assert.ok(!/catch\s*\{\s*\}/.test(sc) && !/Math\.random/.test(sc), "no empty catch, no Math.random");
});

console.log(`${n} passing`);
