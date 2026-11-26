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

await t("offload status: workbench is the preferred CHECKED route, Ollama second as unchecked drafts only", async () => {
  const O = await imp("scripts/offload.mjs");
  process.env.USAGE_MAX_WORKBENCH = okWb; process.env.USAGE_MAX_OLLAMA = "http://127.0.0.1:1";
  try {
    const r = await capture(() => O.main(["status"]));
    assert.match(r.text, /workbench/i); assert.match(r.text, /CHECKED/); assert.match(r.text, /wb_quick/); assert.match(r.text, /wb_delegate/);
    assert.match(r.text, /unchecked drafts only/i);
    assert.ok(r.text.search(/workbench/i) < r.text.search(/ollama|local model/i), "workbench is listed first");
    assert.equal(r.code, 0, "status is ok when the workbench is up even if Ollama is down");
    process.env.USAGE_MAX_WORKBENCH = missing;
    const r2 = await capture(() => O.main(["status"]));
    assert.match(r2.text, /workbench.*not available/i); assert.equal(r2.code, 1);
  } finally { delete process.env.USAGE_MAX_WORKBENCH; delete process.env.USAGE_MAX_OLLAMA; }
});

await t("offload <job>: answer starts with the UNCHECKED DRAFT line, checked:false, distinct exit status 2", async () => {
  const O = await imp("scripts/offload.mjs");
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(req.url === "/api/tags" ? JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] }) : JSON.stringify({ response: "function a() {}" })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const host = "http://127.0.0.1:" + srv.address().port;
  const f = path.join(tmp, "in.js"); fs.writeFileSync(f, "function a(){}");
  try {
    const run = await O.run("docstrings", "function a(){}", { host, name: "a.js" });
    assert.equal(run.ok, true); assert.equal(run.checked, false);
    const first = run.out.split("\n")[0];
    assert.equal(first, "UNCHECKED DRAFT: verify with a test before use; for checked local work use the workbench (wb_quick / wb_delegate)");
    assert.match(run.out, /function a\(\) \{\}/);
    process.env.USAGE_MAX_OLLAMA = host;
    const r = await capture(() => O.main(["docstrings", f]));
    assert.equal(r.code, O.EXIT_UNCHECKED); assert.equal(O.EXIT_UNCHECKED, 2);
    assert.ok(r.text.startsWith("UNCHECKED DRAFT:"), r.text.slice(0, 80));
  } finally { srv.close(); delete process.env.USAGE_MAX_OLLAMA; }
});

console.log(failed ? `\n${failed} FAILED` : "\nlocal-route checks passed");
process.exit(failed ? 1 : 0);
