// Checked local route: workbench availability, offload labelling, route profile. Run on the work PC: node test/local-route.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e && e.message).split("\n").join("\n  ")); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "umlr-"));
const stub = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };
const okWb = stub("ok.mjs", "export async function call(n, a) { return { text: 'up ' + n }; }\n");
const errWb = stub("err.mjs", "export async function call() { return { err: 'pc offline' }; }\n");
const hangWb = stub("hang.mjs", "export async function call() { return new Promise(() => {}); }\n");
const missing = path.join(tmp, "nope.mjs");
const capture = async (fn) => { const lines = [], orig = console.log; console.log = (...a) => lines.push(a.join(" ")); try { return { code: await fn(), text: lines.join("\n") }; } finally { console.log = orig; } };

await t("workbenchAvailable: file present and wb_status ok; missing, err and hang are unavailable", async () => {
  const W = await imp("scripts/workbench.mjs");
  assert.equal((await W.workbenchAvailable({ file: okWb })).available, true);
  assert.equal((await W.workbenchAvailable({ file: missing })).available, false);
  assert.equal((await W.workbenchAvailable({ file: errWb })).available, false);
  const t0 = Date.now(); const h = await W.workbenchAvailable({ file: hangWb, timeoutMs: 300 }); assert.equal(h.available, false); assert.ok(Date.now() - t0 < 5000, "gave up on time");
  process.env.USAGE_MAX_WORKBENCH = okWb; try { assert.equal((await W.workbenchAvailable()).available, true, "env path is used"); } finally { delete process.env.USAGE_MAX_WORKBENCH; }
});

await t("offload status: workbench is the preferred CHECKED route, Ollama second as checked jobs", async () => {
  const O = await imp("scripts/offload.mjs");
  process.env.USAGE_MAX_WORKBENCH = okWb; process.env.USAGE_MAX_OLLAMA = "http://127.0.0.1:1";
  try {
    const r = await capture(() => O.main(["status"]));
    assert.match(r.text, /workbench/i); assert.match(r.text, /CHECKED/); assert.match(r.text, /wb_quick/); assert.match(r.text, /wb_delegate/);
    assert.match(r.text, /checked jobs/i);
    assert.ok(r.text.search(/workbench/i) < r.text.search(/ollama|local model/i), "workbench is listed first");
    assert.equal(r.code, 0, "status is ok when the workbench is up even if Ollama is down");
    process.env.USAGE_MAX_WORKBENCH = missing;
    const r2 = await capture(() => O.main(["status"]));
    assert.match(r2.text, /workbench.*not available/i); assert.equal(r2.code, 1);
  } finally { delete process.env.USAGE_MAX_WORKBENCH; delete process.env.USAGE_MAX_OLLAMA; }
});

const stubOllama = async (queue) => {
  const reqs = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("content-type", "application/json"); if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] })); reqs.push(JSON.parse(b)); res.end(JSON.stringify({ response: queue.shift() ?? "" })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { srv, reqs, host: "http://127.0.0.1:" + srv.address().port };
};

await t("offload docstrings: fenced checked answer is returned, exit 0, check named", async () => {
  const O = await imp("scripts/offload.mjs"); const s = await stubOllama(["```js\n// adds\nfunction a(){}\n```", "```js\n// adds\nfunction a(){}\n```"]);
  const f = path.join(tmp, "in.js"); fs.writeFileSync(f, "function a(){}");
  try {
    const run = await O.run("docstrings", "function a(){}", { host: s.host, name: "a.js" });
    assert.equal(run.ok, true); assert.equal(run.checked, true); assert.equal(run.tries, 1); assert.equal(run.out, "// adds\nfunction a(){}");
    process.env.USAGE_MAX_OLLAMA = s.host;
    const r = await capture(() => O.main(["docstrings", f]));
    assert.equal(r.code, 0); assert.match(r.text, /checked \(code unchanged except comments\)/);
  } finally { s.srv.close(); delete process.env.USAGE_MAX_OLLAMA; }
});

await t("offload docstrings: rejected answers are retried with the reason; third try passes", async () => {
  const O = await imp("scripts/offload.mjs"); const s = await stubOllama(["function b(){}", "function a(){}", "// adds\nfunction a(){}"]);
  try {
    const run = await O.run("docstrings", "function a(){}", { host: s.host, name: "a.js" });
    assert.equal(run.ok, true); assert.equal(run.tries, 3); assert.equal(s.reqs.length, 3);
    assert.ok(s.reqs[1].prompt.includes("Your previous answer was rejected: the code itself was changed"));
    assert.equal(s.reqs[0].options.temperature, 0.2); assert.equal(s.reqs[1].options.temperature, 0.5);
  } finally { s.srv.close(); }
});

await t("offload: three bad answers return an error and nothing else; main exits 1", async () => {
  const O = await imp("scripts/offload.mjs"); const s = await stubOllama(["function b(){}", "function c(){}", "function d(){}", "function b(){}", "function c(){}", "function d(){}"]);
  const f = path.join(tmp, "in2.js"); fs.writeFileSync(f, "function a(){}");
  const origErr = console.error; const errs = [];
  try {
    const run = await O.run("docstrings", "function a(){}", { host: s.host, name: "a.js" });
    assert.match(run.error, /failed its check after 3 tries/); assert.match(run.error, /do this job with Claude/); assert.equal(run.out, undefined);
    process.env.USAGE_MAX_OLLAMA = s.host; console.error = (...a) => errs.push(a.join(" "));
    const r = await capture(() => O.main(["docstrings", f]));
    assert.equal(r.code, 1); assert.equal(r.text, ""); assert.match(errs.join("\n"), /do this job with Claude/);
  } finally { console.error = origErr; s.srv.close(); delete process.env.USAGE_MAX_OLLAMA; }
});

await t("offload convert:yaml has no check: error, and the model is never called", async () => {
  const O = await imp("scripts/offload.mjs"); const s = await stubOllama(["a: 1"]);
  try {
    const run = await O.run("convert:yaml", "{\"a\":1}", { host: s.host, name: "a.json" });
    assert.match(run.error, /no check exists/); assert.equal(s.reqs.length, 0);
  } finally { s.srv.close(); }
});

await t("checkAnswer: summarize and explain are grounded in the input", async () => {
  const C = await imp("scripts/offload-check.mjs"); const input = "retryBlock timeout is 30 seconds";
  assert.equal(C.checkAnswer("summarize", input, "- retryBlock times out after 30 seconds").ok, true);
  const n = C.checkAnswer("summarize", input, "- retryBlock times out after 45 seconds"); assert.equal(n.ok, false); assert.match(n.why, /45/);
  const w = C.checkAnswer("summarize", input, "- callsFooBar fails"); assert.equal(w.ok, false); assert.match(w.why, /callsFooBar/);
  assert.equal(C.checkAnswer("summarize", input, "retryBlock times out").ok, false, "not a bullet");
  assert.equal(C.checkAnswer("explain", input, "It sets `retryBlock` to 30 seconds.").ok, true);
  assert.equal(C.checkAnswer("explain", input, "It sets `other` to 30 seconds.").ok, false);
});

await t("checkAnswer: commit format and file names", async () => {
  const C = await imp("scripts/offload-check.mjs"); const diff = "diff --git a/src/a.js b/src/a.js\n+x";
  assert.equal(C.checkAnswer("commit", diff, "Fix a\n\n- change src/a.js").ok, true);
  const b = C.checkAnswer("commit", diff, "Fix a\n\n- change src/b.js"); assert.equal(b.ok, false); assert.match(b.why, /src\/b\.js/);
  const l = C.checkAnswer("commit", diff, "x".repeat(73)); assert.equal(l.ok, false); assert.match(l.why, /73 characters/);
});

await t("checkAnswer: convert json, csv, tsv; unknown format and job have no check", async () => {
  const C = await imp("scripts/offload-check.mjs");
  assert.equal(C.checkAnswer("convert:json", "x", "{\"a\":1}").ok, true); assert.equal(C.checkAnswer("convert:json", "x", "{a:1}").ok, false);
  assert.equal(C.checkAnswer("convert:csv", "x", "a,b\n1,2").ok, true); assert.equal(C.checkAnswer("convert:csv", "x", "a,b\n1").ok, false);
  assert.equal(C.checkAnswer("convert:tsv", "x", "a\tb\n1\t2").ok, true);
  assert.equal(C.checkAnswer("convert:yaml", "x", "a: 1").check, "none"); assert.equal(C.checkAnswer("zzz", "x", "y").ok, false);
  assert.equal(C.hasCheck("convert:JSON"), true); assert.equal(C.hasCheck("convert:yaml"), false);
});

await t("checkAnswer docstrings: file headers from offload are ignored; blank lines are not comments", async () => {
  const K = await imp("scripts/offload-check.mjs");
  const one = "\n### C:\\x\\in.js\nfunction a(){}";
  assert.equal(K.checkAnswer("docstrings", one, "// adds\nfunction a(){}").ok, true, "header in input, not in answer");
  assert.equal(K.checkAnswer("docstrings", one, "### C:\\x\\in.js\n// adds\nfunction a(){}").ok, true, "header kept in answer");
  assert.equal(K.checkAnswer("docstrings", one, "function a(){}\n\n").why, "no comments were added");
  assert.equal(K.checkAnswer("docstrings", one, "// adds\nfunction a(){ return 1 }").why, "the code itself was changed");
  const two = "\n### a.py\ndef a():\n    return 1\n### b.py\ndef b():\n    return 2";
  assert.equal(K.checkAnswer("docstrings", two, 'def a():\n    """One."""\n    return 1\ndef b():\n    return 2').ok, true, "python docstring, headers dropped");
});

await t("checkAnswer review holes: wrong answers fail, ordinary correct answers pass", async () => {
  const K = await imp("scripts/offload-check.mjs"), ok = (j, i, o) => K.checkAnswer(j, i, o), hdr = "\n### a.js\n";
  // docstrings: wrong answers that used to pass
  assert.equal(ok("docstrings", "function a(){return 1}", "function a(){\n  return 1\n}").ok, false, "re-indent only");
  assert.equal(ok("docstrings", hdr + "function a(){}", "### a.js\nfunction a(){}").why, "no comments were added", "header echoed, no comment");
  assert.equal(ok("docstrings", "x = a // 2\n", "# halve\nx = a // 3").why, "the code itself was changed", "edit after //");
  assert.equal(ok("docstrings", 'q = """select 1"""\n', '# query\nq = """select 2"""').why, "the code itself was changed", "edit inside a triple-quoted string");
  assert.equal(ok("docstrings", "a()\nb()", "// x\na()").why, "part of the code is missing from the answer");
  // docstrings: correct answers that used to fail
  assert.equal(ok("docstrings", "a()\r\nb()\r\n", "// calls a\na()\nb()").ok, true, "CRLF input");
  assert.equal(ok("docstrings", "select 1;", "-- one\nselect 1;").ok, true, "SQL comment");
  assert.equal(ok("docstrings", "def f():\n    return 1", 'def f():\n    """\n    Returns one.\n    """\n    return 1').ok, true, "multi-line python docstring");
  assert.equal(ok("docstrings", 'g = "src/**/*.js"\nh()', '// glob\ng = "src/**/*.js"\n// call\nh()').ok, true, "/* inside a string");
  // grounding: false rejections fixed, invented tokens still caught
  const src = "function readFile() in the JS loader; retries 120 times";
  assert.equal(ok("summarize", src, "- The JavaScript loader calls readFile; works with I/O and Node.js").ok, true, "brand names, I/O, Node.js");
  assert.match(ok("summarize", src, "- retries 12 times").why, /"12"/, "12 is not 120");
  assert.match(ok("summarize", src, "- see lib/loader.js").why, /lib\/loader\.js/, "invented path");
  assert.equal(ok("summarize", src, "- loads files\n  continuing the bullet").ok, true, "wrapped bullet");
  assert.equal(ok("summarize", src, "**Heading**\n- loads").ok, false, "bold heading is not a bullet");
  assert.equal(ok("explain", src, "It reads files, e.g. with readFile. 1. First it loads. 2. Then it retries 120 times.").ok, true, "e.g. and numbered list");
  assert.match(ok("explain", src, "x".repeat(4001)).why, /max 4000/);
  // commit
  const diff = "diff --git a/usage-max/scripts/offload.mjs b/usage-max/scripts/offload.mjs\n+x";
  assert.equal(ok("commit", diff, "Check offload answers\n\n- offload.mjs: works with I/O and Node.js").ok, true, "basename, I/O, Node.js");
  assert.equal(ok("commit", diff, "Fix\n\n  - a\n  - b\n  - c\n  - d\n  - e\n  - f").ok, false, "indented bullets counted");
  // convert
  assert.match(ok("convert:json", "name: Ann\nage: 30\n", "{}").why, /empty/);
  assert.match(ok("convert:json", "name: Ann\nage: 30\n", '{"name":"Bob","age":30}').why, /"Bob"/);
  assert.equal(ok("convert:json", "name: Ann\nage: 30\n", '{"name":"Ann","age":30}').ok, true);
  assert.equal(ok("convert:csv", "Smith, John is 42", 'name,age\n"Smith, Jane",42').ok, false, "invented value");
  assert.equal(ok("convert:csv", "Smith, John is 42", 'name,age\n"Smith, John",42').ok, true, "header names may be chosen");
  assert.equal(ok("convert:csv", "name age: Smith, John 42", 'name,age\n"Smith, John",42').ok, true, "quoted comma");
  assert.equal(ok("convert:tsv", "a b 1 2", "\ta\tb\n1\t2\t").ok, true, "leading and trailing empty tsv fields kept");
  assert.equal(ok("convert:tsv", 'say "hi" there, ok', 'msg\tx\n"hi" there\tok').ok, true, "tsv cell starting with a quote");
  assert.equal(ok("convert:json", "Alice 30", '{"name":"Alice","age":30}').ok, true, "keys may be chosen");
  assert.equal(ok("convert:json", "total 1,234", '{"total":1234}').ok, true, "1,234 is 1234");
  // second review: added code disguised as a comment fails; real comment forms pass
  for (const bad of ["#define X 1", "*p = 0;", "--i;", "#priv = 1", '"""doc""" x = 1']) assert.equal(ok("docstrings", "int a;", bad + "\nint a;").why, "the code itself was changed", bad);
  assert.equal(ok("docstrings", "x = 1", "x = 1  // why").ok, true, "inline comment on an unchanged line");
  assert.equal(ok("docstrings", "x = 1", "x = 2  // why").ok, false, "inline comment on a changed line");
  assert.equal(ok("docstrings", "int a;", "/*\n  plain text line\n*/\nint a;").ok, true, "multi-line block comment");
  assert.equal(ok("docstrings", "int a;", "/*\n  text\n*/ int b;\nint a;").ok, false, "code after a closing */");
  assert.equal(ok("docstrings", "def f():\n    pass", 'def f():\n    """One line."""\n    pass').ok, true, "one-line python docstring");
  assert.equal(ok("docstrings", "a()", "# note\na()").ok, true, "# comment");
  assert.equal(ok("docstrings", "a()", "#!/usr/bin/env node\na()").ok, true, "shebang counts as a comment line");
});

await t("offload: an answer cut off by the token limit is rejected and retried", async () => {
  const O = await imp("scripts/offload.mjs"), http = await import("node:http"), reqs = [];
  const answers = [{ response: "// adds\nfunction a(){}", done_reason: "length" }, { response: "// adds\nfunction a(){}", done_reason: "stop" }];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("content-type", "application/json"); if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] })); reqs.push(JSON.parse(b)); res.end(JSON.stringify(answers.shift() || { response: "" })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const run = await O.run("docstrings", "function a(){}", { host: "http://127.0.0.1:" + srv.address().port, name: "a.js" });
    assert.equal(run.ok, true); assert.equal(run.tries, 2); assert.equal(run.maxTries, 3);
    assert.ok(reqs[1].prompt.includes("the answer was cut off before it finished"));
  } finally { srv.close(); }
});

await t("local-workbench route: in the registry, measured, evidence verifies, unavailable without the workbench", async () => {
  const R = await imp("scripts/governance/route-registry.mjs");
  const up = await R.localWorkbenchRoute({ file: okWb }), down = await R.localWorkbenchRoute({ file: missing });
  assert.equal(up.available, true); assert.equal(down.available, false);
  const reg = R.createRouteRegistry([up]); const p = R.getRouteProfile(reg, "local-workbench");
  assert.equal(p.tier, "local"); assert.equal(p.kind, "local"); assert.equal(p.profileStatus, "measured"); assert.equal(p.qualityFloor, 0.82); assert.equal(p.executorKey, "workbench");
  assert.equal(p.evidencePath, "data/evidence/local-workbench-2026-11-25.json");
  assert.ok(p.estimatedUnits > 0 && p.estimatedUnits <= 25, "low, but includes the Claude-side brief and review cost: " + p.estimatedUnits);
  for (const c of ["code-change-with-check", "bulk-code-shared-check", "offline-code", "code-map-lookup"]) assert.ok(p.capabilities.includes(c), c);
  const v = R.verifyRouteEvidence(reg, root); assert.equal(v.pass, true);
  const ev = JSON.parse(fs.readFileSync(path.join(root, p.evidencePath), "utf8")); assert.match(ev.source, /ACCURACY.md/); assert.equal(ev.claudeTokensPerSmallTask.direct, 8300); assert.equal(ev.claudeTokensPerSmallTask.delegated, 21400);
  assert.equal(R.routesForTask(R.createRouteRegistry([down, { id: "claude", estimatedUnits: 8.3, qualityFloor: 0.9, capabilities: ["code-edit"], profileStatus: "fixture", evidencePath: "x.json" }]), { requiredCapabilities: ["code-edit"] }).some((r) => r.id === "local-workbench"), false);
  assert.equal(R.routesForTask(R.createRouteRegistry([down]), { requiredCapabilities: ["offline-code"] }).length, 0, "unavailable route is never offered");
});

await t("planUsageRoute: small edit without a check stays with Claude; bulk code with a shared check can pick the workbench", async () => {
  const R = await imp("scripts/governance/route-registry.mjs"), C = await imp("scripts/governance/controller.mjs");
  const wb = await R.localWorkbenchRoute({ file: okWb });
  const claude = { id: "claude-sonnet", kind: "model", tier: "sonnet", estimatedUnits: 60, qualityFloor: 0.9, capabilities: ["code-edit", "bulk-code-shared-check", "offline-code"], available: true };
  const plan = (id, caps, routes) => C.planUsageRoute({ task: { id, requiredCapabilities: caps, qualityThreshold: 0.8 }, routes, observation: { state: "unknown" } });
  const small = plan("edit-one-function", ["code-edit"], [claude, wb]);
  assert.equal(small.decision, "admit"); assert.equal(small.selectedRoute.id, "claude-sonnet");
  const bulk = plan("bulk-with-shared-check", ["bulk-code-shared-check"], [claude, wb]);
  assert.equal(bulk.selectedRoute.id, "local-workbench");
  const bulkDown = plan("bulk-with-shared-check", ["bulk-code-shared-check"], [claude, { ...wb, available: false }]);
  assert.equal(bulkDown.selectedRoute.id, "claude-sonnet");
});

await t("routing skill: Local workbench (measured 2026-11-25) section, under 15 lines, with the four rules", async () => {
  const txt = fs.readFileSync(path.join(root, "skills/routing/SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const m = txt.match(/^## Local workbench \(measured 2026-11-25\)\n([\s\S]*?)(?=\n## |(?![\s\S]))/m); assert.ok(m, "section missing");
  const body = m[1].trim(); assert.ok(body.split("\n").length < 15, "section is " + body.split("\n").length + " lines");
  assert.match(body, /kb_search/); assert.match(body, /kb_get/); assert.match(body, /before reading files/);
  assert.match(body, /much larger than its check/); assert.match(body, /offline/); assert.match(body, /2\.6x/); assert.match(body, /only slightly cheaper \(6\.1k vs 6\.9k\)/); assert.match(body, /never use unchecked/i);
  assert.match(txt, /Cheap first, verify, then escalate/);
});

console.log(failed ? `\n${failed} FAILED` : "\nlocal-route checks passed");
process.exit(failed ? 1 : 0);
