import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync, execFileSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "umm-")); process.env.USAGE_MAX_HOME = home;
const proj = path.join(home, "proj"); fs.mkdirSync(proj, { recursive: true });
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const M = await imp("scripts/memory.mjs"), R = await imp("scripts/resume.mjs"), P = await imp("scripts/pack.mjs"), G = await imp("scripts/guard.mjs");
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const cli = (args, cwd = proj, env = {}) => spawnSync("node", [path.join(root, "scripts/usage-max.mjs"), ...args], { cwd, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, ...env } });
const hook = (file, input, env = {}) => spawnSync("node", [path.join(root, file)], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, USAGE_MAX_HOST: "claude", ...env } });

t("no memory yet: finder says null and hooks stay silent", () => {
  assert.equal(M.findMemoryDir(proj), null);
  assert.equal(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", cwd: proj, session_id: "a" }).stdout, "");
  assert.equal(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: "a", prompt: "remember: use pnpm here please" }).stdout, "");
});
const mem = M.init(proj);
t("init creates the layout; decide keeps the newest value per key and is idempotent", () => {
  assert.equal(M.findMemoryDir(path.join(proj, "src/deep")), mem, "found from a subfolder");
  M.decide(mem, "package manager", "npm"); assert.equal(M.decide(mem, "package manager", "npm").unchanged, true);
  const r = M.decide(mem, "package manager", "pnpm"); assert.equal(r.replaced, "npm"); assert.equal(M.decide(mem, "package manager", "pnpm", undefined, { pin: true }).unchanged, undefined, "pinning is a change"); assert.equal(M.readDecisions(mem)[0].pinned, true);
  assert.deepEqual(M.readDecisions(mem).map((d) => [d.key, d.value]), [["package manager", "pnpm"]]);
  assert.ok(M.decide(mem, "", "x").error);
  M.decide(mem, "a|b", "pipes | are fine"); assert.ok(M.readDecisions(mem).some((d) => d.key === "a/b" && d.value === "pipes | are fine"));
});
t("addFact dedupes, rebuilds the index with wikilinks", () => {
  M.addFact(mem, "Billing Engine", "Invoices are immutable once status=sent; corrections are credit notes."); assert.ok(M.addFact(mem, "Billing Engine", "Invoices are immutable once status=sent; corrections are credit notes.").duplicate);
  M.addFact(mem, "Auth", "Refresh tokens rotate on every use; the old one is revoked after 30s grace.");
  assert.match(fs.readFileSync(path.join(mem, "INDEX.md"), "utf8"), /\[\[topics\/billing-engine\]\]/);
  assert.ok(M.addFact(mem, "", "x").error);
});
t("loadBlock lists decisions + topics, respects the cap, newest decision survives", () => {
  const b = M.loadBlock(mem); assert.match(b, /package manager: pnpm/); assert.match(b, /- billing-engine/); assert.match(b, /do not re-ask/i);
  for (let i = 0; i < 80; i++) M.decide(mem, "k" + i, "value number " + i + " ".repeat(5) + "x".repeat(40));
  const small = M.loadBlock(mem, { cap: 900 }); assert.ok(small.length < 1300, String(small.length)); assert.match(small, /k79/); assert.match(small, /\[pinned\] package manager: pnpm/, "pinned survives any number of newer decisions"); assert.match(small, /older in \.memory\/decisions\.md/);
});
t("recall returns the matching section only, once per session, nothing for chatter", () => {
  const seen = new Set(); const r = M.recall(mem, "why did the invoice change after it was sent?", { seen });
  assert.match(r.text, /credit notes/); assert.doesNotMatch(r.text, /Refresh tokens/);
  for (const k of r.keys) seen.add(k); assert.equal(M.recall(mem, "invoice sent", { seen }).text, "", "already injected this session");
  assert.equal(M.recall(mem, "thanks, looks good, please continue", {}).text, ""); assert.equal(M.recall(mem, "", {}).text, "");
  assert.match(M.recall(mem, "token refresh rotate", {}).text, /Refresh tokens/);
});
t("extractDirective", () => {
  assert.equal(M.extractDirective("Remember: the staging DB is read only on Fridays"), "the staging DB is read only on Fridays");
  assert.match(M.extractDirective("From now on, run lint before every commit"), /run lint before every commit/); assert.equal(M.extractDirective("ok. From now on, run lint before every commit"), null, "not at the start: ignored");
  assert.equal(M.extractDirective("I remember that place"), null); assert.equal(M.extractDirective("remember: x"), null, "too short to be a rule");
});
t("sync writes a bounded block into AGENTS.md, keeps the user's text, is idempotent, --check detects drift", () => {
  const f = path.join(proj, "AGENTS.md"); fs.writeFileSync(f, "# My rules\nBe nice.\n");
  assert.equal(M.syncFile(mem, f).changed, true); const a = fs.readFileSync(f, "utf8"); assert.match(a, /Be nice\./); assert.match(a, /usage-max:memory begin/); assert.match(a, /pnpm/);
  assert.equal(M.syncFile(mem, f).changed, false); assert.equal(M.syncCheck(mem, f), true);
  M.decide(mem, "deploy", "never on Fridays"); assert.equal(M.syncCheck(mem, f), false); M.syncFile(mem, f);
  const b = fs.readFileSync(f, "utf8"); assert.equal(b.split("usage-max:memory begin").length, 2); assert.match(b, /never on Fridays/); assert.match(b, /Be nice\./);
  const out = spawnSync("node", [path.join(root, "scripts/memory-cli.mjs"), "sync", "--check"], { cwd: proj, encoding: "utf8" }); assert.equal(out.status, 0, out.stdout);
});
t("import copies Obsidian notes (skips hidden/.obsidian/existing), never touches the source", () => {
  const v = path.join(home, "vault"); fs.mkdirSync(path.join(v, ".obsidian"), { recursive: true }); fs.mkdirSync(path.join(v, "Design"), { recursive: true });
  fs.writeFileSync(path.join(v, ".obsidian/x.md"), "no"); fs.writeFileSync(path.join(v, "Design/Search Index.md"), "# Search\nThe index is rebuilt nightly by the cron worker.\n"); fs.writeFileSync(path.join(v, "Auth.md"), "dup");
  const r = M.importNotes(mem, v); assert.equal(r.imported, 1); assert.ok(fs.existsSync(path.join(mem, "topics/design-search-index.md"))); assert.match(M.recall(mem, "search index nightly", {}).text, /cron worker/);
  assert.equal(fs.readFileSync(path.join(v, "Auth.md"), "utf8"), "dup");
});
t("lint flags a huge topic and a heavy AGENTS.md", () => {
  fs.writeFileSync(path.join(mem, "topics/big.md"), "# Big\n" + "line of notes\n".repeat(900)); const l = M.lint(mem); assert.ok(l.some((x) => /big\.md/.test(x))); fs.rmSync(path.join(mem, "topics/big.md"));
});
t("hook e2e: SessionStart injects the block, prompt recall + remember: capture, Stop saves a resume point", () => {
  const s = JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: proj, session_id: "s1" }).stdout); assert.match(s.hookSpecificOutput.additionalContext, /package manager: pnpm/); assert.match(s.hookSpecificOutput.additionalContext, /usage-max\.mjs" memory/);
  const u = JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: "s1", prompt: "remember: tests live in __checks__ not test/. Also why can't I edit an invoice once it is sent?" }).stdout);
  assert.match(u.hookSpecificOutput.additionalContext, /credit notes/); assert.match(u.systemMessage, /saved to project memory/); assert.ok(M.readDecisions(mem).some((d) => /__checks__/.test(d.value)));
  assert.equal(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: "s1", prompt: "edit invoice once sent, again" }).stdout, "", "section not repeated in the same session");
  assert.equal(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", cwd: proj, session_id: "s1" }, { USAGE_MAX_HOST: "codex" }).stdout, "", "silent under Codex");
  assert.equal(hook("hooks/memory.mjs", "garbage").status, 0);
});
t("resume: built from transcript + git, saved at Stop, handed to the next fresh session ONCE, not to a resumed one", () => {
  const tr = path.join(home, "tr.jsonl"); const line = (o) => JSON.stringify(o) + "\n";
  fs.writeFileSync(tr, line({ type: "user", message: { role: "user", content: "add rate limiting to the login route" } }) + line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ignored" }] } })
    + line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Added middleware; tests for the 429 path still to write." }, { type: "tool_use", name: "Edit", input: { file_path: "src/login.js" } }] } }) + line({ type: "user", message: { role: "user", content: "<system-reminder>noise</system-reminder>" } }));
  execFileSync("git", ["init", "-q"], { cwd: proj }); fs.writeFileSync(path.join(proj, "dirty.txt"), "x");
  const text = R.buildResume({ transcript: tr, cwd: proj }); assert.match(text, /add rate limiting/); assert.match(text, /429 path/); assert.match(text, /src\/login\.js/); assert.match(text, /dirty\.txt/); assert.doesNotMatch(text, /noise|ignored/);
  assert.equal(R.buildResume({ transcript: path.join(home, "none"), cwd: proj }), null);
  hook("hooks/memory.mjs", { hook_event_name: "Stop", cwd: proj, session_id: "s2", transcript_path: tr });
  const dir = path.join(home, ".claude", "usage-max"); fs.mkdirSync(dir, { recursive: true });
  const r1 = JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "clear", cwd: proj, session_id: "s3" }).stdout).hookSpecificOutput.additionalContext; assert.match(r1, /Resume point/); assert.match(r1, /may be stale/);
  assert.doesNotMatch(JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: proj, session_id: "s4" }).stdout).hookSpecificOutput.additionalContext, /Resume point/, "taken once");
  fs.utimesSync(R.resumeFile(R.sharedDir(), proj), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  assert.doesNotMatch(JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "resume", cwd: proj, session_id: "s5" }).stdout).hookSpecificOutput.additionalContext, /Resume point/, "resumed sessions already have their context");
  assert.equal(R.saveResume(R.sharedDir(), proj, "again", { minGapMs: 3600e3 }), false, "throttled");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ resume: "off" })); fs.rmSync(path.join(dir, "resume", "x"), { force: true });
  const before = fs.statSync(R.resumeFile(R.sharedDir(), proj)).mtimeMs; fs.utimesSync(R.resumeFile(R.sharedDir(), proj), new Date(1), new Date(1)); hook("hooks/memory.mjs", { hook_event_name: "Stop", cwd: proj, session_id: "s2", transcript_path: tr }); assert.equal(fs.statSync(R.resumeFile(R.sharedDir(), proj)).mtimeMs, 1, "resume:off respected"); fs.rmSync(path.join(dir, "config.json"));
});
t("cold-cache message offers /clear when the resume point is automatic, still mentions handoff", () => {
  const d = path.join(home, "g"); fs.mkdirSync(d, { recursive: true }); G.promptCheck(d, "c", { now: 1e9, ctx: 90000 });
  assert.match(G.promptCheck(d, "c", { now: 1e9 + 400e3, ctx: 90000, autoResume: true }), /\/clear now.*handoff.*saved automatically/s);
});
t("readGate: >400KB whole-file read held once, ranged and small reads pass, config can turn it off", () => {
  const d = path.join(home, "g2"); fs.mkdirSync(d, { recursive: true }); const f = path.join(home, "huge.log"); fs.writeFileSync(f, "x".repeat(450000));
  assert.match(G.readGate(d, "r", { file_path: f }).deny, /450 KB.*Read again/s); assert.equal(G.readGate(d, "r", { file_path: f }), null, "second ask goes through");
  assert.equal(G.readGate(d, "r2", { file_path: f, limit: 100 }), null); assert.equal(G.readGate(d, "r2", { file_path: path.join(home, "AGENTS.md") }), null);
  fs.writeFileSync(path.join(d, "config.json"), JSON.stringify({ readBlock: false })); assert.equal(G.readGate(d, "r3", { file_path: f }), null);
  const o = hook("hooks/guard.mjs", { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: f }, session_id: "hk" }); assert.equal(JSON.parse(o.stdout).hookSpecificOutput.permissionDecision, "deny");
});
t("codex hook: memory block on SessionStart, recall on prompt, silent when no .memory", () => {
  const ch = path.join(root, "codex/scripts/codex-hook.mjs"); const env = { ...process.env, USAGE_MAX_HOME: home }; delete env.PLUGIN_ROOT;
  const h = (ev, input) => spawnSync("node", [ch, ev], { input: JSON.stringify(input), encoding: "utf8", env });
  assert.match(h("SessionStart", { session_id: "cx", cwd: proj }).stdout, /Project memory[\s\S]*package manager: pnpm/);
  assert.match(h("UserPromptSubmit", { session_id: "cx", cwd: proj, prompt: "the refresh token rotation looks wrong" }).stdout, /Refresh tokens rotate/);
  assert.doesNotMatch(h("SessionStart", { session_id: "cy", cwd: home }).stdout, /Project memory/);
});
t("sync copies memory.mjs into the Codex stable bin", async () => {
  const { syncBin } = await imp("codex/scripts/sync.mjs"); const r = syncBin({ root, home, force: true }); assert.equal(r.changed, true); assert.ok(fs.existsSync(path.join(home, ".usage-max-codex/bin/scripts/memory.mjs")));
});
t("pack: scoped prompt with files, detected test, memory notes; --save writes a short phone prompt; --setup detects installs", () => {
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ scripts: { test: "node t.js" } })); fs.writeFileSync(path.join(proj, "pnpm-lock.yaml"), "");
  const r = P.run(["fix invoice rounding", "--files", "src/invoice.js,src/tax.js"], proj); assert.match(r.out, /Files to change: src\/invoice\.js, src\/tax\.js/); assert.match(r.out, /`pnpm test` passes/); assert.match(r.out, /credit notes/); assert.match(r.out, /10 lines or fewer/);
  const s = P.run(["fix invoice rounding", "--save"], proj); assert.match(s.out, /Do the task in \.codex-tasks\/fix-invoice-rounding\.md/); assert.ok(fs.existsSync(path.join(proj, ".codex-tasks/fix-invoice-rounding.md")));
  assert.match(P.run(["--setup"], proj).out, /pnpm install --frozen-lockfile/); assert.equal(P.run([], proj).code, 1);
});
t("CLI: memory + pack + resume through the one entry point", () => {
  assert.match(cli(["memory", "status"]).stdout, /decision\(s\).*topic\(s\)/); assert.match(cli(["memory", "recall", "refresh", "token"]).stdout, /Refresh tokens/);
  assert.match(cli(["memory", "decide", "retries", "3"]).stdout, /decided: retries/); assert.match(cli(["memory", "decide", "--pin", "region", "eu-west-1 only"]).stdout, /decided: region/); assert.ok(M.readDecisions(mem).some((d) => d.key === "region" && d.pinned && d.value === "eu-west-1 only"), "--pin must not swallow the key"); assert.match(cli(["memory", "add", "queue", "jobs retry with backoff"]).stdout, /noted in/);
  assert.equal(cli(["memory", "status"], home).status, 0); assert.match(cli(["memory", "add", "x", "y"], home).stdout, /no project memory/);
  assert.match(cli(["pack", "do the thing", "--files", "a.js"]).stdout, /# Task: do the thing/); assert.match(cli(["resume"]).stdout, /Resume point|no resume point/);
});
t("enable-here --lean-auto refuses without history", () => { const r = cli(["enable-here", proj, "--lean-auto"]); assert.equal(r.status, 1); assert.match(r.stdout, /needs usage history/); });

// ---- regressions from the independent review
t("never overwrites a file it could not read (EISDIR stands in for a locked file); sync --files does not write 'null'", () => {
  const d = path.join(proj, "LOCKED.md"); fs.mkdirSync(d); const r = M.syncFile(mem, d); assert.ok(r.error); assert.equal(r.changed, false); assert.ok(fs.statSync(d).isDirectory());
  fs.mkdirSync(path.join(mem, "topics", "stuck.md")); assert.ok(M.addFact(mem, "stuck", "a fact").error); fs.rmdirSync(path.join(mem, "topics", "stuck.md"));
  fs.writeFileSync(path.join(proj, "CLAUDE.md"), "keep me\n"); const o = spawnSync("node", [path.join(root, "scripts/memory-cli.mjs"), "sync", "--files", "CLAUDE.md"], { cwd: proj, encoding: "utf8" });
  assert.equal(o.status, 0, o.stdout + o.stderr); assert.ok(!fs.existsSync(path.join(proj, "null"))); assert.match(fs.readFileSync(path.join(proj, "CLAUDE.md"), "utf8"), /keep me[\s\S]*usage-max:memory begin/);
  assert.equal(spawnSync("node", [path.join(root, "scripts/memory-cli.mjs"), "sync", "--check", "--files", "CLAUDE.md"], { cwd: proj, encoding: "utf8" }).status, 0);
});
t("two notes starting with the same four words are both kept", () => {
  const a = "always use tabs in python files", b = "always use tabs in go files"; assert.notEqual(M.directiveKey(a), M.directiveKey(b));
  M.decide(mem, M.directiveKey(a), a); M.decide(mem, M.directiveKey(b), b); const v = M.readDecisions(mem).map((d) => d.value); assert.ok(v.includes(a) && v.includes(b));
});
t("directive only counts at the START of the prompt; pasted text is ignored; secrets are refused everywhere", () => {
  assert.equal(M.extractDirective("Here is the email:\nGoing forward, we will bill monthly and keep a ledger."), null);
  assert.equal(M.extractDirective("Summary of the changelog. From now on the API is versioned per release."), null);
  assert.ok(M.extractDirective("From now on, answer in short sentences"));
  assert.equal(M.extractDirective("remember: the prod password is hunter2hunter2"), null, "secret-looking directive not captured");
  for (const bad of ["use sk-live-abcdefghijklmnop1234 for billing", "password: Tr0ub4dor&3xyz", "AKIAABCDEFGHIJKLMNOP is the key", "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"]) { assert.ok(M.looksSecret(bad), bad); assert.ok(M.decide(mem, "x", bad).error, bad); assert.ok(M.addFact(mem, "x", bad).error, bad); }
  assert.ok(!M.looksSecret("the password lives in 1Password item Billing"));
});
t("resume point is redacted and no longer an order", () => {
  const tr = path.join(home, "tr2.jsonl"); fs.writeFileSync(tr, JSON.stringify({ type: "user", message: { role: "user", content: "call the API with key sk-live-abcdefghijklmnop1234 please" } }) + "\n" + JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }) + "\n");
  const x = R.buildResume({ transcript: tr, cwd: proj }); assert.doesNotMatch(x, /sk-live/); assert.match(x, /\[redacted\]/);
  R.saveResume(path.join(home, "rd"), proj, x); const out = hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "clear", cwd: proj, session_id: "rr" }, { USAGE_MAX_HOME: home });
  assert.doesNotMatch(out.stdout, /Continue from here unless/);
});
t("recall: one common word does not inject; whole words only; two real hits do; explicit recall is looser", () => {
  M.addFact(mem, "testing", "Run the suite with pnpm test; snapshots live in __snapshots__."); M.addFact(mem, "rapid-api", "Third party quota is 100 requests per minute.");
  assert.equal(M.recall(mem, "fix the test", {}).text, "", "one generic word"); assert.equal(M.recall(mem, "what is the app doing", {}).text, "", "'app' must not match 'rapid-api'");
  assert.equal(M.recall(mem, "ship the api", {}).text, ""); assert.match(M.recall(mem, "where do snapshots live for the test suite", {}).text, /__snapshots__/);
  assert.match(M.recall(mem, "quota", { loose: true }).text, /100 requests/);
});
t("compact/clear/startup forgets what was injected, so a topic can be injected again", () => {
  const sid = "seen1", p = "why can't I edit an invoice once it is sent?";
  assert.match(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: sid, prompt: p }).stdout, /credit notes/); assert.equal(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: sid, prompt: p }).stdout, "");
  hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "compact", cwd: proj, session_id: sid }); assert.match(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: sid, prompt: p }).stdout, /credit notes/);
});
t("finder stops at the repo root: a parent folder's or ~/.memory is not picked up", () => {
  const outer = path.join(home, "outer"); fs.mkdirSync(path.join(outer, "repo", "src"), { recursive: true }); M.init(outer); fs.mkdirSync(path.join(outer, "repo", ".git"));
  assert.equal(M.findMemoryDir(path.join(outer, "repo", "src")), null); assert.ok(M.findMemoryDir(outer));
});
t("pack: --save before the goal works, never overwrites a different task, handles renames", () => {
  assert.match(P.run(["--save", "refactor billing totals"], proj).out, /refactor-billing-totals\.md/);
  const w = path.join(proj, ".codex-tasks"); fs.writeFileSync(path.join(w, "same-goal.md"), "an older, different task\n"); const r = P.run(["same goal"], proj); assert.match(P.run(["same goal", "--save"], proj).out, /same-goal-2\.md/); assert.equal(fs.readFileSync(path.join(w, "same-goal.md"), "utf8"), "an older, different task\n");
  assert.match(P.run(["--setup"], proj).out, /pnpm/);
});
t("readGate lets PDFs/images/notebooks through; codex hook prints memory even if the budget code throws", () => {
  const d = path.join(home, "g3"); fs.mkdirSync(d, { recursive: true }); const f = path.join(home, "scan.pdf"); fs.writeFileSync(f, "x".repeat(450000)); assert.equal(G.readGate(d, "p", { file_path: f }), null);
  const ch = path.join(root, "codex/scripts/codex-hook.mjs"); const bad = path.join(home, "badhome"); fs.mkdirSync(bad, { recursive: true }); fs.writeFileSync(path.join(bad, ".usage-max-codex"), "a file, not a folder"); // dataDir() is unusable
  const o = spawnSync("node", [ch, "SessionStart"], { input: JSON.stringify({ session_id: "z", cwd: proj }), encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: bad, PLUGIN_ROOT: "" } }); assert.equal(o.status, 0); assert.match(o.stdout, /Project memory/);
});

// ---- new chats with hand-offs, both tools
const roll = path.join(home, ".codex", "sessions", "2026", "10", "11"); fs.mkdirSync(roll, { recursive: true });
const rollFile = path.join(roll, "rollout-2026-10-11T10-00-00-cdx-sess-1.jsonl"); const cl = (o) => JSON.stringify(o) + "\n";
fs.writeFileSync(rollFile, cl({ type: "turn_context", payload: { model: "gpt-6.1" } }) + cl({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /x\n..." }] } })
  + cl({ type: "event_msg", payload: { type: "user_message", message: "move the retry logic into queue/worker.js" } }) + cl({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "move the retry logic into queue/worker.js" }] } })
  + cl({ type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Update File: queue/worker.js\n@@\n*** Add File: queue/retry.js\n*** End Patch" } })
  + cl({ type: "event_msg", payload: { type: "agent_message", message: "Moved it; still need to update the two callers." } }) + cl({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 150000 } } } }));
const cx = (ev, input, env = {}) => spawnSync("node", [path.join(root, "codex/scripts/codex-hook.mjs"), ev], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, PLUGIN_ROOT: "", USAGE_MAX_MEMORY_DIR: "/nonexistent", ...env } });
t("Codex rollout digest: real user asks (not AGENTS.md preamble), patched files, last message; finder prefers the session id", () => {
  const d = R.digestCodex(rollFile); assert.deepEqual(d.users, ["move the retry logic into queue/worker.js"]); assert.ok(d.files.includes("queue/worker.js") && d.files.includes("queue/retry.js")); assert.match(d.last, /two callers/);
  assert.equal(R.findRollout({ sessionId: "cdx-sess-1", codexHome: path.join(home, ".codex") }), rollFile); assert.equal(R.findRollout({ sessionId: "nope", codexHome: path.join(home, ".codex"), now: Date.now() + 99e6 }), null);
  assert.equal(R.findRollout({ transcript: rollFile, codexHome: "/none" }), rollFile);
});
t("Codex Stop saves a resume point; the next fresh CLAUDE session in that folder is told, once (cross-tool hand-off)", () => {
  const w = path.join(home, "handoff-proj"); fs.mkdirSync(w, { recursive: true });
  assert.equal(cx("Stop", { session_id: "cdx-sess-1", cwd: w }).status, 0); const f = R.resumeFile(R.sharedDir(), w); assert.match(fs.readFileSync(f, "utf8"), /from Codex[\s\S]*retry logic[\s\S]*queue\/worker\.js/);
  const out = JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: w, session_id: "k1" }).stdout).hookSpecificOutput.additionalContext; assert.match(out, /from Codex/);
  assert.equal(hook("hooks/memory.mjs", { hook_event_name: "SessionStart", source: "startup", cwd: w, session_id: "k2" }).stdout, "", "taken once per tool");
});
t("Claude's resume point reaches a fresh Codex chat (and not a resumed one); other folders see nothing", () => {
  const w = path.join(home, "handoff2"); fs.mkdirSync(w, { recursive: true }); const tr = path.join(home, "tr3.jsonl");
  fs.writeFileSync(tr, JSON.stringify({ type: "user", message: { role: "user", content: "wire the webhook retries" } }) + "\n" + JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Webhook done; docs left." }] } }) + "\n");
  hook("hooks/memory.mjs", { hook_event_name: "Stop", cwd: w, session_id: "k3", transcript_path: tr });
  assert.match(cx("SessionStart", { session_id: "cx9", cwd: w, source: "startup" }).stdout, /from Claude Code[\s\S]*webhook retries[\s\S]*may be stale/);
  assert.equal(cx("SessionStart", { session_id: "cx10", cwd: w, source: "startup" }).stdout, "", "once"); R.saveResume(R.sharedDir(), w, "x2", { minGapMs: 0 });
  assert.doesNotMatch(cx("SessionStart", { session_id: "cx11", cwd: w, source: "resume" }).stdout, /Resume point/); assert.doesNotMatch(cx("SessionStart", { session_id: "cx12", cwd: path.join(home, "elsewhere") }).stdout, /Resume point/);
});
t("resume --repo writes a redacted .codex-tasks/RESUME.md for Codex cloud/mobile; nothing to write = polite message", () => {
  const w = path.join(home, "handoff3"); fs.mkdirSync(w, { recursive: true }); R.saveResume(R.sharedDir(), w, "Resume point\nLast: use key sk-live-abcdefghijklmnop1234 to call X", { minGapMs: 0 });
  const o = cli(["resume", "--repo"], w); assert.match(o.stdout, /Continue from \.codex-tasks\/RESUME\.md/); const f = fs.readFileSync(path.join(w, ".codex-tasks/RESUME.md"), "utf8"); assert.doesNotMatch(f, /sk-live/); assert.match(f, /Continue the work/);
  fs.mkdirSync(path.join(home, "none-yet"), { recursive: true }); assert.match(cli(["resume", "--repo"], path.join(home, "none-yet")).stdout, /no resume point/);
});

// ---- nothing is ever cut short silently; suggest never saves by itself
t("a too-long decision/fact/directive is REFUSED with a clear reason, never clipped; the block never clips a line", () => {
  const long = "x".repeat(301), r = M.decide(mem, "longkey", long); assert.match(r.error, /301 characters; the limit is 300.*never cut short/s); assert.ok(!M.readDecisions(mem).some((d) => d.key === "longkey"));
  assert.ok(M.decide(mem, "k".repeat(61), "v").error); assert.ok(M.addFact(mem, "notes", "y".repeat(601)).error); assert.ok(!M.addFact(mem, "notes", "y".repeat(600)).error);
  const exactly = "z".repeat(300); assert.equal(M.decide(mem, "exact", exactly).value, exactly);
  const block = M.loadBlock(mem, { cap: 1e6 }); assert.ok(block.includes("exact: " + exactly), "whole value in the block"); assert.ok(!/…/.test(block.split("Topics")[0]), "no ellipsis inside decisions");
  const o = JSON.parse(hook("hooks/memory.mjs", { hook_event_name: "UserPromptSubmit", cwd: proj, session_id: "long1", prompt: "remember: " + "word ".repeat(100) }).stdout); assert.match(o.systemMessage, /not saved.*limit is 300/s);
  M.addFact(mem, "wordy", "A summary line that goes on for a really long time without any sign of stopping so that it has to be shortened for the topic list pointer");
  const sum = M.listTopics(mem).find((x) => x.slug === "wordy").summary; assert.match(sum, /…$/); assert.ok(!/\s…/.test(sum.slice(0, -2)), "cut at a word boundary"); assert.ok(sum.length <= 104);
});
t("suggest: finds instructions and grouped commands with sources, ranks orientation docs above dated records, saves NOTHING until --accept", async () => {
  const S = await imp("scripts/memory-suggest.mjs"); const r = path.join(home, "sugg"); fs.mkdirSync(path.join(r, "docs"), { recursive: true }); fs.mkdirSync(path.join(r, "node_modules/x"), { recursive: true });
  fs.writeFileSync(path.join(r, "README.md"), "# Proj\n\nAlways run the linter before committing.\nThe password is never printed.\nIt was fast.\n\n## Testing\n```\nnpm ci\nnpm test   # 40 tests\n```\n\n## Notes\nSecret: use sk-live-abcdefghijklmnop1234 for billing, and you must not share it.\n| Never | in a table |\n");
  fs.writeFileSync(path.join(r, "04_SESSION_2026-09-20_old.md"), "# Old\nNever trust this old record, it must be ignored.\n"); fs.writeFileSync(path.join(r, "node_modules/x/README.md"), "Always skip me please, this is vendored.\n");
  fs.writeFileSync(path.join(r, "docs/long.md"), "Always " + "very ".repeat(60) + "long.\n");
  const list = S.suggest(r); const texts = list.map((c) => c.text);
  assert.ok(texts.some((t) => /Always run the linter/.test(t))); assert.ok(texts.some((t) => t === "Testing: npm ci; npm test"), JSON.stringify(texts));
  assert.ok(!texts.some((t) => /password is never printed|It was fast|sk-live|skip me|very very|table/.test(t)), "descriptions, secrets, vendored, over-long and table rows are not offered");
  assert.ok(list.findIndex((c) => /linter/.test(c.text)) < list.findIndex((c) => /old record/.test(c.text)) || !texts.some((t) => /old record/.test(t)), "README outranks the dated record");
  assert.ok(list.every((c) => /^[^:]+:\d+$/.test(c.source) && c.text.length <= 200) && list.length <= 25);
  const rp = path.join(home, "sugg-mem"); fs.mkdirSync(rp, { recursive: true }); const sm = M.init(rp); fs.cpSync(r, rp, { recursive: true }); // suggest reads the repo around .memory
  const cli2 = (a) => spawnSync("node", [path.join(root, "scripts/memory-cli.mjs"), ...a], { cwd: rp, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home } });
  const listed = cli2(["suggest"]); assert.match(listed.stdout, /Nothing has been saved/); assert.equal(M.readDecisions(sm).length, 0, "listing saves nothing");
  const ok = cli2(["suggest", "--accept", "1,2,99"]); assert.match(ok.stdout, /saved #1/); assert.match(ok.stdout, /NOT saved #99/);
  assert.ok(M.readDecisions(sm).some((d) => /\(source: README\.md:\d+\)$/.test(d.value)) || fs.readdirSync(path.join(sm, "topics")).length > 0, "accepted items carry their source");
  assert.equal(cli2(["suggest", "--accept"]).status, 1);
});
console.log(n, "passing");
