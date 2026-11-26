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

await t("local-workbench route: in the registry, measured, evidence verifies, unavailable without the workbench", async () => {
  const R = await imp("scripts/governance/route-registry.mjs");
  const up = await R.localWorkbenchRoute({ file: okWb }), down = await R.localWorkbenchRoute({ file: missing });
  assert.equal(up.available, true); assert.equal(down.available, false);
  const reg = R.createRouteRegistry([up]); const p = R.getRouteProfile(reg, "local-workbench");
  assert.equal(p.tier, "local"); assert.equal(p.kind, "local"); assert.equal(p.profileStatus, "measured"); assert.equal(p.qualityFloor, 0.83); assert.equal(p.executorKey, "workbench");
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

console.log(failed ? `\n${failed} FAILED` : "\nlocal-route checks passed");
process.exit(failed ? 1 : 0);
