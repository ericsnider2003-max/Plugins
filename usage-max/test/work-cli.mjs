// Offline tests for `usage-max work` (scripts/work-cli.mjs). Temp roots via --root and USAGE_MAX_HOME.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(R, "scripts", "usage-max.mjs");
const load = (f) => import(pathToFileURL(path.join(R, "scripts", "governance", f)).href);
const dq = await load("durable-queue.mjs");
const { admitWorkUnit, recordUsageOutcome } = await load("queue-gate.mjs");
const registryMod = await load("route-registry.mjs");

let failures = 0, total = 0;
function check(name, actual, expected) {
  total += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`); }
}
const dirs = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const HOME = tmp("work-cli-home-");
const work = (args) => spawnSync(process.execPath, [CLI, "work", ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: HOME } });
const qdir = (root) => path.join(root, "operations", "runs", "usage-max", "queue");
const hash = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const reseal = (f, rec) => fs.writeFileSync(f, JSON.stringify({ ...rec, recordHash: hash({ ...rec, recordHash: null }) }, null, 2));
const taskJson = (dir, id) => {
  const f = path.join(dir, `${id}.task.json`);
  fs.writeFileSync(f, JSON.stringify({ workId: id, mode: "interactive", task: { id, qualityThreshold: 0.85, requiredCapabilities: ["extract"] }, observation: { state: "unknown", authority: "none" }, recoveryReserve: { requiredUnits: 5, availableUnits: 5 } }));
  return f;
};

// enqueue -> list -> show
const root = tmp("work-cli-root-");
let r = work(["enqueue", taskJson(root, "W-1"), "--root", root]);
check("enqueue exit 0", r.status, 0);
check("enqueue prints workId and state", JSON.parse(r.stdout), { workId: "W-1", state: "queued" });
r = work(["list", "--root", root]);
check("list shows the unit", [r.status, /^W-1  queued  attempt 0  \d{4}-/.test(r.stdout)], [0, true]);
r = work(["list", "--json", "--root", root]);
check("list --json", JSON.parse(r.stdout).map((x) => [x.workId, x.state, x.attempt]), [["W-1", "queued", 0]]);
r = work(["show", "W-1", "--root", root]);
check("show returns the record", [r.status, JSON.parse(r.stdout).workId, JSON.parse(r.stdout).state], [0, "W-1", "queued"]);
check("duplicate enqueue exits 1", work(["enqueue", taskJson(root, "W-1"), "--root", root]).status, 1);

// tamper
const f1 = path.join(qdir(root), "W-1.json");
const rec1 = JSON.parse(fs.readFileSync(f1, "utf8")); rec1.state = "verified";
fs.writeFileSync(f1, JSON.stringify(rec1));
r = work(["list", "--root", root]);
check("tampered record listed INVALID", [r.status, /^W-1  INVALID /.test(r.stdout)], [0, true]);
r = work(["show", "W-1", "--root", root]);
check("tampered show exits non-zero", [r.status, /hash mismatch/.test(r.stderr)], [1, true]);

// verify: receipts via the governance API
const vroot = tmp("work-cli-verify-");
const now = new Date().toISOString();
const routes = [{ id: "local-deterministic", kind: "local", tier: "local", estimatedUnits: 0, qualityFloor: 0.86, capabilities: ["extract"] }];
const task = { id: "W-2", qualityThreshold: 0.85, requiredCapabilities: ["extract"] };
const adm = admitWorkUnit({ root: vroot, request: { workId: "W-2", attemptId: "A-1", leaseId: "L-1", plan: { mode: "interactive", task, observation: { state: "fresh", authority: "provider", capturedAt: now, now, source: "fixture" }, routes, recoveryReserve: { requiredUnits: 5, availableUnits: 5 } } } });
recordUsageOutcome({ root: vroot, workId: "W-2", attemptId: "A-1", routeFingerprint: adm.plan.routeFingerprint, outcome: { taskId: "W-2", qualityScore: 0.9, requiredEvidence: ["receipt"], evidence: ["receipt"] } });
r = work(["verify", "W-2", "A-1", "--root", vroot]);
check("verify passes", [r.status, JSON.parse(r.stdout).pass], [0, true]);
const op = path.join(vroot, "operations", "runs", "usage-max", "events", "W-2--A-1--outcome.json");
const out = JSON.parse(fs.readFileSync(op, "utf8")); out.outcome.qualityScore = 0.1; fs.writeFileSync(op, JSON.stringify(out));
r = work(["verify", "W-2", "A-1", "--root", vroot]);
check("verify with tampered receipt exits 1", [r.status, JSON.parse(r.stdout).pass], [1, false]);
check("verify with missing receipts exits 1", work(["verify", "W-2", "NOPE", "--root", vroot]).status, 1);

// recover: one expired lease, one live lease
const rroot = tmp("work-cli-recover-");
const prof = (id, tier, units, floor) => ({ id, kind: "local", tier, estimatedUnits: units, qualityFloor: floor, capabilities: ["extract"], profileStatus: "fixture", evidencePath: `${id}.json` });
const registry = registryMod.createRouteRegistry([prof("local-deterministic", "local", 0, 0.86)]);
fs.writeFileSync(path.join(rroot, "local-deterministic.json"), JSON.stringify({ routeId: "local-deterministic", profileStatus: "fixture", capabilities: ["extract"], qualityFloor: 0.86, estimatedUnits: 0 }));
for (const id of ["STALE-1", "LIVE-1"]) {
  work(["enqueue", taskJson(rroot, id), "--root", rroot]);
  dq.admitQueuedWorkUnit({ root: rroot, workId: id, registry });
}
const sf = path.join(qdir(rroot), "STALE-1.json");
const srec = JSON.parse(fs.readFileSync(sf, "utf8")); srec.activeAttempt.expiresAt = new Date(Date.now() - 60000).toISOString(); reseal(sf, srec);
r = work(["recover", "--json", "--root", rroot]);
check("recover recovers only the expired lease", [r.status, JSON.parse(r.stdout).recovered], [0, [{ workId: "STALE-1", state: "retryable" }]]);
check("recovered unit is retryable, live unit stays admitted", [dq.readQueuedWorkUnit({ root: rroot, workId: "STALE-1" }).state, dq.readQueuedWorkUnit({ root: rroot, workId: "LIVE-1" }).state], ["retryable", "admitted"]);
r = work(["recover", "--root", rroot]);
check("second recover finds nothing", [r.status, r.stdout.trim()], [0, "nothing to recover."]);

// review fixes: recover continues past a locked unit; no root dir for read-only commands; --root value; incomplete enqueue JSON
const lroot = tmp("work-cli-lock-");
fs.writeFileSync(path.join(lroot, "local-deterministic.json"), JSON.stringify({ routeId: "local-deterministic", profileStatus: "fixture", capabilities: ["extract"], qualityFloor: 0.86, estimatedUnits: 0 }));
for (const id of ["STALE-A", "STALE-B"]) {
  work(["enqueue", taskJson(lroot, id), "--root", lroot]);
  dq.admitQueuedWorkUnit({ root: lroot, workId: id, registry });
  const f = path.join(qdir(lroot), `${id}.json`);
  const rec = JSON.parse(fs.readFileSync(f, "utf8")); rec.activeAttempt.expiresAt = new Date(Date.now() - 60000).toISOString(); reseal(f, rec);
}
fs.writeFileSync(path.join(qdir(lroot), "STALE-A.lock"), JSON.stringify({ workId: "STALE-A", pid: process.pid, acquiredAt: new Date().toISOString() }));
r = work(["recover", "--json", "--root", lroot]);
let lj = { recovered: [], failed: [] }; try { lj = JSON.parse(r.stdout); } catch {}
check("recover continues past a locked unit and exits 1", [r.status, lj.recovered.map((x) => x.workId), lj.failed.map((x) => x.workId), /locked/.test(lj.failed[0]?.error)], [1, ["STALE-B"], ["STALE-A"], true]);
check("the unlocked unit was recovered", dq.readQueuedWorkUnit({ root: lroot, workId: "STALE-B" }).state, "retryable");
r = work(["recover", "--root", lroot]);
check("recover text lists recovered and failed", [r.status, /failed STALE-A/.test(r.stdout)], [1, true]);

const mroot = path.join(tmp("work-cli-missing-"), "nope");
r = work(["list", "--root", mroot]);
check("list on missing root: no work units, exit 0", [r.status, r.stdout.trim()], [0, "no work units."]);
check("show on missing root exits 1 not found", [work(["show", "W-9", "--root", mroot]).status, /not found/.test(work(["show", "W-9", "--root", mroot]).stderr)], [1, true]);
r = work(["verify", "W-9", "A-1", "--root", mroot]);
check("verify on missing root exits 1 not found", [r.status, /not found/.test(r.stdout)], [1, true]);
r = work(["recover", "--root", mroot]);
check("recover on missing root: nothing to recover, exit 0", [r.status, r.stdout.trim()], [0, "nothing to recover."]);
check("invalid id exits 2 on missing root", work(["show", "../x", "--root", mroot]).status, 2);
check("read-only commands leave no root dir", fs.existsSync(mroot), false);
check("--root followed by --json exits 2", work(["list", "--root", "--json"]).status, 2);
const nt = path.join(root, "notask.json"); fs.writeFileSync(nt, JSON.stringify({ workId: "N-1" }));
r = work(["enqueue", nt, "--root", root]);
check("enqueue missing task exits 2 naming the field", [r.status, /task\.id/.test(r.stderr)], [2, true]);

// usage errors
check("bad subcommand exits 2", work(["bogus"]).status, 2);
check("no subcommand exits 2", work([]).status, 2);
check("unknown option exits 2", work(["list", "--nope", "--root", root]).status, 2);
check("missing arg exits 2", work(["show", "--root", root]).status, 2);
r = work(["show", "../x", "--root", root]);
check("invalid workId exits 2 with the identifier error", [r.status, /workId contains unsafe path characters/.test(r.stderr)], [2, true]);
const bad = path.join(root, "bad.task.json"); fs.writeFileSync(bad, JSON.stringify({ workId: "a/b", task: { id: "a/b" } }));
check("enqueue invalid workId exits 2", work(["enqueue", bad, "--root", root]).status, 2);
check("help exits 0", work(["help"]).status, 0);
check("help notes the programmatic API", /programmatic API in scripts\/governance/.test(work(["help"]).stdout), true);

// default root (dataDir() = <USAGE_MAX_HOME>/.claude/usage-max) and OneDrive warning
const droot = path.join(HOME, ".claude", "usage-max", "work");
r = work(["enqueue", taskJson(root, "D-1")]);
check("default root is <USAGE_MAX_HOME>/.claude/usage-max/work", [r.status, fs.existsSync(path.join(qdir(droot), "D-1.json"))], [0, true]);
const od = path.join(tmp("work-cli-od-"), "OneDrive", "q");
r = work(["list", "--root", od]);
check("OneDrive root warns once on stderr", [r.status, r.stderr.trim().split("\n").length, /OneDrive/.test(r.stderr)], [0, 1, true]);
check("no warning for a normal root", work(["list", "--root", root]).stderr, "");

for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
console.log(`\n${total - failures}/${total} work-cli checks passed`);
process.exit(failures ? 1 : 0);
