// Provider-neutral continuity bridge. Local-only, deterministic, and no-model.
// It preserves task evidence and bounded file identities, not hidden transcripts.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureContinuity, verifyContinuity } from "./context-continuity.mjs";
import { loadTasks, saveTask, taskSnapshot } from "./task-store.mjs";

const dataDir = (home) => path.join(home, ".usage-max");
const bundleDir = (home) => path.join(dataDir(home), "context-bridge");
const safeId = (value) => String(value || "").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 160) || "task";
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value) => new Date(value || Date.now()).toISOString();
const active = (state) => !["completed", "dead_letter"].includes(state);

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

function normalizedTask(task) {
  return { taskId: task.taskId, state: task.state, provider: task.provider || null, surface: task.surface || null, accountSlot: task.accountSlot || null, requestedModel: task.requestedModel || null, requestedEffort: task.requestedEffort || null, modelDecision: task.modelDecision || null, checkpoint: task.checkpoint || null, effects: (task.effects || []).map((x) => ({ effectId: x.effectId, kind: x.kind, state: x.state, resultDigest: x.resultDigest || null })), retry: task.retry || null, attempt: task.attempt || 0, updatedAt: task.updatedAt || null };
}
function body(bundle) { const { bundleDigest, generatedAt, ...rest } = bundle; return rest; }
function render(bundle) {
  const t = bundle.task; const list = (items) => items?.length ? items.map((x) => `- ${String(x).replace(/\r?\n/g, " ")}`).join("\n") : "- none recorded";
  const files = bundle.context?.files?.length ? bundle.context.files.map((x) => `- ${x.path} — ${x.present ? `sha256:${x.digest}` : `unavailable (${x.reason || "unknown"})`}`).join("\n") : "- none recorded";
  return `# Continuity bridge: ${t.taskId}\n\nGenerated locally at ${bundle.generatedAt}. This is evidence, not a transcript.\n\n## State\n\n- Task: ${t.taskId}\n- State: ${t.state}\n- Provider/surface: ${t.provider || "unknown"}/${t.surface || "unknown"}\n- Account slot: ${t.accountSlot || "unknown"}\n- Requested model/effort: ${t.requestedModel || "unknown"}/${t.requestedEffort || "unknown"}\n- Attempt: ${t.attempt}\n- Bundle digest: sha256:${bundle.bundleDigest}\n\n## Next actions\n\n${list(bundle.continuation.nextActions)}\n\n## Decisions\n\n${list(bundle.continuation.decisions)}\n\n## Acceptance criteria\n\n${list(bundle.continuation.acceptanceCriteria)}\n\n## Constraints and tests\n\n${list(bundle.continuation.constraints)}\n\n${list(bundle.continuation.tests)}\n\n## Workspace evidence\n\n${files}\n\n## Safety boundary\n\n- No provider transcript or hidden conversation was copied.\n- No credentials, tokens, prompts, or response bodies are included.\n- Resume must verify the bundle digest, checkpoint, effects, acceptance criteria, and file digests.\n- Missing or divergent evidence is a stop condition, not permission to guess.\n`;
}

export function bundleFile(home, taskId, extension = "json") { return path.join(bundleDir(home), `${safeId(taskId)}.${extension}`); }
export function createContextBundle({ home = os.homedir(), task, workspaceRoot = null, files = [], decisions = [], nextActions = [], acceptanceCriteria = [], constraints = [], tests = [], now = Date.now() } = {}) {
  if (!task?.taskId) throw new Error("task is required");
  const capturedContext = captureContinuity({ workspaceRoot, files, checkpoint: task.checkpoint, effects: task.effects || [], acceptanceCriteria });
  // Capture time is metadata, not evidence. Excluding it from the digest makes
  // idle service ticks true no-ops while file/checkpoint changes still rewrite.
  const context = capturedContext ? { ...capturedContext, capturedAt: null } : null;
  const continuation = { decisions: [...new Set(decisions.map(String))].slice(0, 64), nextActions: [...new Set(nextActions.map(String))].slice(0, 64), acceptanceCriteria: [...new Set(acceptanceCriteria.map(String))].slice(0, 64), constraints: [...new Set(constraints.map(String))].slice(0, 64), tests: [...new Set(tests.map(String))].slice(0, 64) };
  const bundle = { contract: "usage-max.context-bridge.v1", version: 1, generatedAt: iso(now), task: normalizedTask(task), continuation, context, safety: { localOnly: true, transcriptIncluded: false, messageBodiesIncluded: false, credentialsIncluded: false, resumeRequiresVerification: true } };
  return { ...bundle, bundleDigest: digest(body(bundle)) };
}
export function writeContextBundle(options = {}) {
  const bundle = createContextBundle(options); const home = options.home || os.homedir(); const jsonFile = bundleFile(home, bundle.task.taskId, "json"); const mdFile = bundleFile(home, bundle.task.taskId, "md");
  let previous = null; try { previous = JSON.parse(fs.readFileSync(jsonFile, "utf8")); } catch {}
  if (!previous || previous.bundleDigest !== bundle.bundleDigest) { atomic(jsonFile, JSON.stringify(bundle, null, 2)); atomic(mdFile, render(bundle)); return { changed: true, bundle, jsonFile, mdFile }; }
  return { changed: false, bundle: previous, jsonFile, mdFile };
}
export function readContextBundle(home = os.homedir(), taskId) { try { return JSON.parse(fs.readFileSync(bundleFile(home, taskId), "utf8")); } catch { return null; } }
export function verifyContextBundle(bundle, options = {}) {
  if (!bundle || bundle.contract !== "usage-max.context-bridge.v1" || bundle.version !== 1) return { ready: false, reason: "context bridge bundle is missing or unsupported", mismatches: ["bundle"] };
  const mismatches = digest(body(bundle)) === bundle.bundleDigest ? [] : ["bundle-digest"];
  if (bundle.safety?.credentialsIncluded || bundle.safety?.messageBodiesIncluded || bundle.safety?.transcriptIncluded) mismatches.push("unsafe-content-flag");
  if (bundle.context?.files?.some((x) => x.present) && !options.workspaceRoot) mismatches.push("workspace-root-required");
  const continuity = verifyContinuity({ context: bundle.context }, { workspaceRoot: options.workspaceRoot, files: options.files || null, checkpoint: options.checkpoint || bundle.task.checkpoint, effects: options.effects || bundle.task.effects, acceptanceCriteria: options.acceptanceCriteria || bundle.continuation.acceptanceCriteria });
  if (!continuity.ready) mismatches.push(...continuity.mismatches);
  return { ready: mismatches.length === 0, reason: mismatches.length ? "context bridge evidence diverged" : "context bridge evidence matches", mismatches };
}
export function refreshAutomaticBundles({ home = os.homedir(), tasks = null, now = Date.now() } = {}) {
  const source = tasks || loadTasks(path.join(dataDir(home), "tasks.jsonl")); const results = [];
  for (const task of source.values()) {
    const bridge = task.contextBridge; if (!active(task.state) || bridge?.enabled !== true) continue;
    try { results.push(writeContextBundle({ home, task, workspaceRoot: bridge.workspaceRoot || null, files: bridge.files || [], decisions: bridge.decisions || [], nextActions: bridge.nextActions || [], acceptanceCriteria: bridge.acceptanceCriteria || [], constraints: bridge.constraints || [], tests: bridge.tests || [], now })); }
    catch (error) { results.push({ changed: false, taskId: task.taskId, error: String(error.message || error) }); }
  }
  return { refreshed: results.filter((x) => x.changed).length, unchanged: results.filter((x) => x.changed === false && !x.error).length, errors: results.filter((x) => x.error), results };
}
export function setAutomaticContext({ home = os.homedir(), taskId, enabled = true, workspaceRoot = null, files = [], decisions = [], nextActions = [], acceptanceCriteria = [], constraints = [], tests = [], now = new Date().toISOString() } = {}) {
  const file = path.join(dataDir(home), "tasks.jsonl"); const task = taskSnapshot(file, taskId); if (!task) throw new Error(`task not found: ${taskId}`);
  const contextBridge = enabled ? { enabled: true, workspaceRoot: workspaceRoot ? path.resolve(workspaceRoot) : null, files: [...new Set(files.map(String))], decisions: [...new Set(decisions.map(String))], nextActions: [...new Set(nextActions.map(String))], acceptanceCriteria: [...new Set(acceptanceCriteria.map(String))], constraints: [...new Set(constraints.map(String))], tests: [...new Set(tests.map(String))] } : { enabled: false };
  const updated = { ...task, contextBridge, updatedAt: iso(now) }; saveTask(file, updated); return updated;
}
function argsList(args, flag) { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? String(args[i + 1]).split(",").map((x) => x.trim()).filter(Boolean) : []; }
function cli() {
  const [op = "status", taskId, ...rest] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
  if (op === "refresh") { console.log(JSON.stringify(refreshAutomaticBundles({ home }), null, 2)); return 0; }
  if (op === "verify") { const bundle = readContextBundle(home, taskId); const workspaceRoot = rest.includes("--workspace") ? rest[rest.indexOf("--workspace") + 1] : null; const r = verifyContextBundle(bundle, { workspaceRoot, files: argsList(rest, "--files") }); console.log(JSON.stringify(r, null, 2)); return r.ready ? 0 : 1; }
  if (op === "enable" || op === "disable") { const enabled = op === "enable"; const w = rest.includes("--workspace") ? rest[rest.indexOf("--workspace") + 1] : null; const updated = setAutomaticContext({ home, taskId, enabled, workspaceRoot: w, files: argsList(rest, "--files"), decisions: argsList(rest, "--decisions"), nextActions: argsList(rest, "--next"), acceptanceCriteria: argsList(rest, "--accept"), constraints: argsList(rest, "--constraints"), tests: argsList(rest, "--tests") }); console.log(`${enabled ? "enabled" : "disabled"} deterministic context bridge for ${updated.taskId}`); return 0; }
  if (op === "write") { const task = taskSnapshot(path.join(dataDir(home), "tasks.jsonl"), taskId); if (!task) throw new Error(`task not found: ${taskId}`); const r = writeContextBundle({ home, task, workspaceRoot: rest.includes("--workspace") ? rest[rest.indexOf("--workspace") + 1] : null, files: argsList(rest, "--files"), decisions: argsList(rest, "--decisions"), nextActions: argsList(rest, "--next"), acceptanceCriteria: argsList(rest, "--accept"), constraints: argsList(rest, "--constraints"), tests: argsList(rest, "--tests") }); console.log(`${r.changed ? "wrote" : "unchanged"} ${r.jsonFile}\n${r.mdFile}`); return 0; }
  console.log("usage: context-bridge.mjs refresh | enable <taskId> [--workspace dir] [--files a,b] [--decisions a,b] [--next a,b] [--accept a,b] | disable <taskId> | write <taskId> | verify <taskId>"); return 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) process.exit(cli());
