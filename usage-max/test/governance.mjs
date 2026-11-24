// Offline tests for scripts/governance (ported Umbrella governance core). Inputs mirror Umbrella's validate-usage-max-*.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const G = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "governance");
const load = (f) => import(pathToFileURL(path.join(G, f)).href);
const { planUsageRoute, verifyUsageOutcome } = await load("controller.mjs");
const { admitWorkUnit, recordUsageOutcome, verifyAdmission, UsageAdmissionError } = await load("queue-gate.mjs");
const { verifyUsageReceipts } = await load("verify-receipts.mjs");
const { createRouteRegistry } = await load("route-registry.mjs");
const dq = await load("durable-queue.mjs");
const { dispatchQueuedWorkUnit } = await load("coordinator.mjs");
const { assertSafeIdentifier } = await load("identifiers.mjs");
const { planParallelSkills, dispatchParallelSkillWork, verifyParallelReceipt } = await load("parallel-dispatch.mjs");
const { normalizeCodexAppLimits } = await load("provider-observation.mjs");
const { readLiveCodexObservation, resolveApprovedCodexSlot } = await load("live-observation.mjs");

let failures = 0, total = 0;
function check(name, actual, expected) {
  total += 1;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`); }
}
function throwsMsg(fn) { try { fn(); return "no-throw"; } catch (e) { return e; } }
const matches = (r, re) => (r instanceof Error ? re.test(r.message) : r);
const roots = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); roots.push(d); return d; };

const routes = [
  { id: "local-deterministic", kind: "local", tier: "local", estimatedUnits: 0, qualityFloor: 0.86, capabilities: ["extract"] },
  { id: "small-model", kind: "model", tier: "small", estimatedUnits: 10, qualityFloor: 0.9, capabilities: ["extract"] },
  { id: "council", kind: "model", tier: "strong", estimatedUnits: 40, qualityFloor: 0.99, capabilities: ["extract"] },
];
const reserve = { requiredUnits: 5, availableUnits: 5 };
const task = (id) => ({ id, qualityThreshold: 0.85, requiredCapabilities: ["extract"] });

// controller
const interactive = planUsageRoute({ mode: "interactive", task: task("T1"), observation: { state: "unknown", authority: "none" }, routes, recoveryReserve: reserve });
check("controller interactive unknown allowance admits cheapest route", [interactive.decision, interactive.selectedRoute.id, interactive.bounded, interactive.allowance.state], ["admit", "local-deterministic", true, "unknown"]);
const batch = planUsageRoute({ mode: "batch", task: task("T2"), observation: { state: "stale", authority: "provider" }, routes, recoveryReserve: reserve });
check("controller stale batch allowance holds", [batch.decision, batch.batchGate, batch.reason], ["hold", "hold", "batch-requires-fresh-provider-observation"]);
const falseFresh = planUsageRoute({ mode: "batch", task: task("T3"), observation: { state: "fresh", authority: "none", capturedAt: new Date().toISOString() }, routes, recoveryReserve: reserve });
check("controller fresh label without provider authority holds as unknown", [falseFresh.decision, falseFresh.allowance.state], ["hold", "unknown"]);
const expired = planUsageRoute({ mode: "batch", task: task("T4"), observation: { state: "fresh", authority: "provider", capturedAt: "2020-01-01T00:00:00.000Z", now: new Date().toISOString(), maxAgeMs: 1000 }, routes, recoveryReserve: reserve });
check("controller expired fresh capture holds as stale", [expired.decision, expired.allowance.state], ["hold", "stale"]);
const okOutcome = verifyUsageOutcome(interactive, { taskId: "T1", qualityScore: 0.86, requiredEvidence: ["receipt"], evidence: ["receipt"] });
check("controller outcome at floor passes", okOutcome.pass, true);
const low = verifyUsageOutcome(interactive, { taskId: "T1", qualityScore: 0.84, requiredEvidence: ["receipt"], evidence: ["receipt"] });
check("controller outcome below quality floor rejected", [low.pass, low.decision, low.reason], [false, "escalate-or-reopen", "quality-floor-not-met"]);
const wrongId = verifyUsageOutcome(interactive, { taskId: "OTHER", qualityScore: 0.99, requiredEvidence: [], evidence: [] });
check("controller outcome task identity mismatch rejected", [wrongId.pass, wrongId.reason], [false, "task-identity-mismatch"]);

// identifiers
check("identifiers accept plain id", assertSafeIdentifier("WORK-001", "id"), "WORK-001");
for (const bad of ["../x", "a/b", "a\\b", "..", ".", "", "-lead"]) {
  check(`identifiers reject ${JSON.stringify(bad)}`, matches(throwsMsg(() => assertSafeIdentifier(bad, "id")), /id (contains unsafe path characters|must be 1-128 characters)/), true);
}

// queue-gate round trip
const gateRoot = tmp("gov-gate-");
const now = new Date().toISOString();
const admitted = admitWorkUnit({ root: gateRoot, request: { workId: "WORK-001", attemptId: "ATTEMPT-001", leaseId: "LEASE-001", plan: { mode: "interactive", task: task("WORK-001"), observation: { state: "fresh", authority: "provider", capturedAt: now, now, source: "fixture" }, routes, recoveryReserve: reserve } } });
check("queue-gate admission file written", fs.existsSync(admitted.filePath), true);
check("queue-gate verifyAdmission returns workId", verifyAdmission({ root: gateRoot, workId: "WORK-001", attemptId: "ATTEMPT-001", routeFingerprint: admitted.plan.routeFingerprint }).workId, "WORK-001");
const rec = recordUsageOutcome({ root: gateRoot, workId: "WORK-001", attemptId: "ATTEMPT-001", routeFingerprint: admitted.plan.routeFingerprint, outcome: { taskId: "WORK-001", qualityScore: 0.86, requiredEvidence: ["receipt"], evidence: ["receipt"] } });
check("queue-gate recordUsageOutcome verifies", rec.verification.pass, true);
check("queue-gate verifyUsageReceipts passes", verifyUsageReceipts(gateRoot, "WORK-001", "ATTEMPT-001").pass, true);
const cli = spawnSync(process.execPath, [path.join(G, "verify-receipts.mjs"), gateRoot, "WORK-001", "ATTEMPT-001"], { encoding: "utf8" });
check("verify-receipts CLI exit 0", cli.status, 0);
check("verify-receipts CLI prints pass:true", /"pass":true/.test(cli.stdout), true);
const tampered = JSON.parse(fs.readFileSync(admitted.filePath, "utf8"));
tampered.plan.selectedRoute.id = "council";
fs.writeFileSync(admitted.filePath, JSON.stringify(tampered), "utf8");
check("queue-gate tampered admission rejected", matches(throwsMsg(() => verifyAdmission({ root: gateRoot, workId: "WORK-001", attemptId: "ATTEMPT-001", routeFingerprint: admitted.plan.routeFingerprint })), /hash mismatch/), true);
check("queue-gate stale batch admission throws UsageAdmissionError", throwsMsg(() => admitWorkUnit({ root: gateRoot, request: { workId: "WORK-002", attemptId: "ATTEMPT-002", leaseId: "LEASE-002", plan: { mode: "batch", task: task("WORK-002"), observation: { state: "stale", authority: "provider" }, routes } } })) instanceof UsageAdmissionError, true);

// route-registry
check("route-registry rejects unbound profile", matches(throwsMsg(() => createRouteRegistry([{ id: "unbound", estimatedUnits: 1, qualityFloor: 0.9, capabilities: ["extract"], profileStatus: "fixture" }])), /evidencePath is required/), true);
const profile = (id, tier, units, floor) => ({ id, kind: id.startsWith("local") ? "local" : "model", tier, estimatedUnits: units, qualityFloor: floor, capabilities: ["extract"], profileStatus: "fixture", evidencePath: `${id}.json` });
const evidence = (id, units, floor) => JSON.stringify({ routeId: id, profileStatus: "fixture", capabilities: ["extract"], qualityFloor: floor, estimatedUnits: units });
const registry = createRouteRegistry([profile("local-deterministic", "local", 0, 0.86), profile("small-model", "small", 10, 0.9)]);
function queueRoot(p) {
  const r = tmp(p);
  fs.writeFileSync(path.join(r, "local-deterministic.json"), evidence("local-deterministic", 0, 0.86));
  fs.writeFileSync(path.join(r, "small-model.json"), evidence("small-model", 10, 0.9));
  return r;
}
const req = (id) => ({ workId: id, mode: "interactive", task: task(id), observation: { state: "unknown", authority: "none" }, recoveryReserve: reserve });
const outcome = (id, q) => ({ taskId: id, qualityScore: q, requiredEvidence: ["receipt"], evidence: ["receipt"] });

// evidence tamper
const evRoot = queueRoot("gov-evidence-");
dq.enqueueWorkUnit({ root: evRoot, request: req("EVIDENCE-001") });
fs.writeFileSync(path.join(evRoot, "local-deterministic.json"), evidence("local-deterministic", 0, 0.1));
check("route-registry altered evidence rejected at admission", matches(throwsMsg(() => dq.admitQueuedWorkUnit({ root: evRoot, workId: "EVIDENCE-001", registry })), /evidence quality floor mismatch/), true);

// durable-queue: enqueue -> admit -> checkpoint -> complete; retry
const qr = queueRoot("gov-queue-");
dq.enqueueWorkUnit({ root: qr, request: req("QUEUE-001") });
const a1 = dq.admitQueuedWorkUnit({ root: qr, workId: "QUEUE-001", registry }).queue.activeAttempt;
check("durable-queue first attempt uses cheapest route", a1.routeId, "local-deterministic");
dq.checkpointWorkUnit({ root: qr, workId: "QUEUE-001", attemptId: a1.attemptId, leaseId: a1.leaseId, checkpoint: { phase: "first-attempt" } });
const failed = dq.completeWorkUnit({ root: qr, workId: "QUEUE-001", attemptId: a1.attemptId, leaseId: a1.leaseId, outcome: outcome("QUEUE-001", 0.80) });
check("durable-queue below-floor completion is retryable", failed.queue.state, "retryable");
check("durable-queue stale attempt is fenced", matches(throwsMsg(() => dq.checkpointWorkUnit({ root: qr, workId: "QUEUE-001", attemptId: a1.attemptId, leaseId: a1.leaseId, checkpoint: { phase: "stale" } })), /stale attempt is fenced/), true);
dq.prepareRetryWorkUnit({ root: qr, workId: "QUEUE-001", failedRouteId: a1.routeId });
const a2 = dq.admitQueuedWorkUnit({ root: qr, workId: "QUEUE-001", registry }).queue.activeAttempt;
check("retry gets a new attempt id", a1.attemptId !== a2.attemptId, true);
const done = dq.completeWorkUnit({ root: qr, workId: "QUEUE-001", attemptId: a2.attemptId, leaseId: a2.leaseId, outcome: outcome("QUEUE-001", 0.91) });
check("durable-queue retry completion verified", done.queue.state, "verified");
check("durable-queue verifyQueueRecord passes", dq.verifyQueueRecord({ root: qr, workId: "QUEUE-001" }).pass, true);
check("durable-queue keeps one checkpoint", dq.readQueuedWorkUnit({ root: qr, workId: "QUEUE-001" }).checkpoints.length, 1);

// coordinator
dq.enqueueWorkUnit({ root: qr, request: req("QUEUE-002") });
const disp = await dispatchQueuedWorkUnit({ root: qr, workId: "QUEUE-002", registry, executors: { "local-deterministic": async ({ workId }) => outcome(workId, 0.88) } });
check("coordinator queued dispatch verified", [disp.decision, disp.queue.state], ["verified", "verified"]);

// registry drift
const drift = createRouteRegistry([profile("local-deterministic", "local", 99, 0.86), profile("small-model", "small", 10, 0.9)]);
dq.enqueueWorkUnit({ root: qr, request: req("QUEUE-003") });
dq.admitQueuedWorkUnit({ root: qr, workId: "QUEUE-003", registry });
check("durable-queue registry drift rejected", matches(throwsMsg(() => dq.admitQueuedWorkUnit({ root: qr, workId: "QUEUE-003", registry: drift })), /registry drift/), true);

// locks and abandoned lease
const lockDir = path.join(qr, "operations", "runs", "usage-max", "queue");
fs.writeFileSync(path.join(lockDir, "QUEUE-LOCK.lock"), '{"held":true}', "utf8");
check("durable-queue held lock rejected", matches(throwsMsg(() => dq.enqueueWorkUnit({ root: qr, request: { workId: "QUEUE-LOCK", mode: "interactive", task: task("QUEUE-LOCK") } })), /queue is locked/), true);
fs.unlinkSync(path.join(lockDir, "QUEUE-LOCK.lock"));
fs.writeFileSync(path.join(lockDir, "QUEUE-STALE.lock"), JSON.stringify({ workId: "QUEUE-STALE", pid: 2147483647, acquiredAt: "2020-01-01T00:00:00.000Z" }), "utf8");
dq.enqueueWorkUnit({ root: qr, request: { workId: "QUEUE-STALE", mode: "interactive", task: task("QUEUE-STALE") } });
check("durable-queue stale lock recovered", dq.readQueuedWorkUnit({ root: qr, workId: "QUEUE-STALE" }).state, "queued");
dq.enqueueWorkUnit({ root: qr, request: req("QUEUE-004") });
dq.admitQueuedWorkUnit({ root: qr, workId: "QUEUE-004", registry });
const aband = dq.recoverAbandonedWorkUnit({ root: qr, workId: "QUEUE-004", now: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
check("recoverAbandonedWorkUnit after stale lease", [aband.recovered, aband.queue.state], [true, "retryable"]);

// parallel dispatch
const skills = [
  { id: "research", tags: ["research"], writeScopes: ["research/a"], estimatedUnits: 2 },
  { id: "security", tags: ["security"], writeScopes: ["research/b"], estimatedUnits: 2 },
  { id: "quality", tags: ["quality"], writeScopes: ["validation/a"], estimatedUnits: 2 },
  { id: "synthesis", tags: ["synthesis"], dependencies: ["research", "security"], writeScopes: ["synthesis/a"], estimatedUnits: 1 },
];
const plan = planParallelSkills({ task: { id: "parallel-eval", skillIds: ["research", "security", "quality", "synthesis"] }, skills, maxParallel: 3 });
check("parallel plan: parallel, 2 waves, 3 in first", [plan.decision, plan.waves.length, plan.waves[0].length, plan.waves[1]], ["parallel", 2, 3, ["synthesis"]]);
check("parallel plan by tags", planParallelSkills({ task: { id: "tag-eval", requiredSkillTags: ["quality", "research"] }, skills, maxParallel: 2 }).requestedSkillIds, ["research", "quality"]);
const conflict = planParallelSkills({ task: { id: "c", skillIds: ["left", "right"] }, skills: [{ id: "left", writeScopes: ["same"] }, { id: "right", writeScopes: ["same"] }], maxParallel: 2 });
check("parallel plan serializes write-scope conflict", [conflict.decision, conflict.waves.map((w) => w.length)], ["serial", [1, 1]]);
const hold = planParallelSkills({ task: { id: "b", skillIds: ["research", "security"] }, skills, maxEstimatedUnits: 3 });
check("parallel plan holds over budget", [hold.decision, hold.reason], ["hold", "parallel-skill-budget-exceeded"]);
const proot = tmp("gov-par-");
let active = 0, peak = 0;
const run = await dispatchParallelSkillWork({ root: proot, task: { id: "dispatch-eval", skillIds: ["research", "security", "quality", "synthesis"] }, skills, maxParallel: 3, submitAndDispatch: async (request) => {
  active += 1; peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 5));
  active -= 1;
  return { dispatched: { decision: "verified", queue: { state: "verified" }, outcome: { artifactVerification: { pass: true } } }, request };
} });
check("parallel dispatch verified, 4 results, peak<=3", [run.decision, run.results.length, peak <= 3], ["verified", 4, true]);
check("parallel receipt verifies", verifyParallelReceipt({ root: proot, taskId: "dispatch-eval", receiptFile: path.relative(proot, run.receiptPath) }).pass, true);
const hroot = tmp("gov-par-hold-");
const held = await dispatchParallelSkillWork({ root: hroot, task: { id: "held-eval", skillIds: ["research", "security"] }, skills, maxEstimatedUnits: 3, submitAndDispatch: async () => { throw new Error("held batch must not execute"); } });
check("parallel held batch writes hold receipt", [held.decision, verifyParallelReceipt({ root: hroot, taskId: "held-eval", receiptFile: path.relative(hroot, held.receiptPath) }).decision], ["hold", "hold"]);
const uroot = tmp("gov-par-untrusted-");
const untrusted = await dispatchParallelSkillWork({ root: uroot, task: { id: "untrusted-eval", skillIds: ["research"] }, skills, submitAndDispatch: async () => ({ dispatched: { decision: "verified" } }) });
check("parallel untrusted executor result escalates", untrusted.decision, "escalate-or-reopen");

// provider-observation
const cap = new Date().toISOString();
const norm = normalizeCodexAppLimits({ ordinaryUsageAllowed: true, rateLimitsByLimitId: { codex: { limitId: "codex", primary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: 1795529849 } } } }, { accountSlot: "codex-primary-live", capturedAt: cap, now: cap });
check("provider-observation normalize", [norm.state, norm.authority, norm.remainingFraction, norm.accountId], ["fresh", "provider", 0.19, undefined]);
check("provider-observation batch admits on fresh provider data", planUsageRoute({ mode: "batch", task: task("CODEX"), observation: norm, routes, recoveryReserve: reserve }).decision, "admit");
check("provider-observation requires accountSlot", matches(throwsMsg(() => normalizeCodexAppLimits({ rateLimits: { primary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: 1795529849 } } }, { capturedAt: cap, now: cap })), /approved accountSlot is required/), true);
check("provider-observation rejects usedPercent > 100", matches(throwsMsg(() => normalizeCodexAppLimits({ rateLimits: { primary: { usedPercent: 101, windowDurationMins: 10080, resetsAt: 1795529849 } } }, { accountSlot: "codex-primary-live", capturedAt: cap, now: cap })), /usedPercent must be between/), true);

// live-observation (env USAGE_MAX_PROVIDER_CACHE, temp fixture)
const lroot = tmp("gov-live-");
const cachePath = path.join(lroot, "provider-limits.json");
const accountsPath = path.join(lroot, "accounts.json");
fs.writeFileSync(accountsPath, JSON.stringify({ accounts: [{ slot: "codex-primary-live", provider: "openai", approved: true, enabled: true, routingEnabled: true, surfaces: ["codex-cli"] }] }), "utf8");
const snapshot = { captureStatus: { codex: "fresh" }, captureSources: { codex: "provider-live" }, freshCaptures: { codex: { source: "codex-app-server", capturedAt: "2026-11-19T14:44:30.000Z", model: "gpt-5.6-luna", effort: "low", rate_limits: { codex_primary: { used_percentage: 91, window_minutes: 10080, resets_at: 1795529849 } } } } };
fs.writeFileSync(cachePath, JSON.stringify(snapshot), "utf8");
const liveNow = "2026-11-19T14:45:00.000Z";
const savedEnv = process.env.USAGE_MAX_PROVIDER_CACHE;
process.env.USAGE_MAX_PROVIDER_CACHE = cachePath;
const live = readLiveCodexObservation({ accountsPath, now: liveNow });
check("live-observation reads env cache: fresh provider", [live.state, live.authority, live.remainingFraction], ["fresh", "provider", 0.09]);
check("live-observation resolves approved slot", resolveApprovedCodexSlot({ accountsPath }), "codex-primary-live");
check("live-observation fresh batch admits", planUsageRoute({ mode: "batch", task: task("LIVE-1"), observation: live, routes: [{ id: "local", estimatedUnits: 0, qualityFloor: 0.9, capabilities: ["extract"] }], recoveryReserve: { requiredUnits: 1, availableUnits: 1 } }).decision, "admit");
check("live-observation stale after 15 minutes", readLiveCodexObservation({ accountsPath, now: "2026-11-19T15:01:00.000Z" }).state, "stale");
fs.writeFileSync(cachePath, JSON.stringify({ ...snapshot, captureSources: { codex: "local-fallback" } }), "utf8");
check("live-observation rejects non provider-live capture", matches(throwsMsg(() => readLiveCodexObservation({ accountsPath, now: liveNow })), /not provider-live/), true);
if (savedEnv === undefined) delete process.env.USAGE_MAX_PROVIDER_CACHE; else process.env.USAGE_MAX_PROVIDER_CACHE = savedEnv;

for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
console.log(`\n${total - failures}/${total} governance checks passed`);
process.exit(failures ? 1 : 0);
