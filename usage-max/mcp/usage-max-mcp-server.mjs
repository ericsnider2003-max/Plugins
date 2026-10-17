#!/usr/bin/env node
// Read-only local MCP surface for ChatGPT Desktop/Codex/Claude host attachment.
// It exposes Usage-max evidence and state, never credentials, provider control,
// account switching, worker launch, or enforcement.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { compatibilityReport } from "../scripts/compatibility-doctor.mjs";
import { readLedger } from "../scripts/observation-ledger.mjs";
import { defaultObservationLedger } from "../scripts/provider-ingest.mjs";
import { readOutbox } from "../scripts/notification-bridge.mjs";
import { readinessReport } from "../scripts/readiness.mjs";
import { taskConsole } from "../scripts/task-console.mjs";
import { loadAccounts } from "../scripts/accounts.mjs";
import { loadArchitectureGraph, queryArchitecture, shortestArchitecturePath, explainArchitecture } from "../scripts/architecture-graph.mjs";
import { readFailureHealth } from "../scripts/failure-health.mjs";

const home = process.env.USAGE_MAX_HOME || os.homedir();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolList = [
  { name: "usage_max_get_status", description: "Read the current Usage-max readiness, compatibility, service, enforcement, and surface-capability state. This never changes state.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_list_observations", description: "List bounded, redacted provider observations with model, allowance window, authority, freshness, and capture time. Missing data remains missing.", inputSchema: { type: "object", properties: { surface: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 }, response_format: { type: "string", enum: ["json", "markdown"], default: "json" } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_list_notices", description: "List bounded Usage-max notices for review, including approval, quota, handoff, verification, retry, and safety notices. This never acknowledges or delivers them.", inputSchema: { type: "object", properties: { surface: { type: "string", maxLength: 80 }, include_delivered: { type: "boolean", default: false }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 }, response_format: { type: "string", enum: ["json", "markdown"], default: "json" } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_get_tasks", description: "Read the durable task console projection, including state, provider, model decision, quota evidence, checkpoint, lease, retry, health, and wake information.", inputSchema: { type: "object", properties: { task_id: { type: "string", maxLength: 160 }, response_format: { type: "string", enum: ["json", "markdown"], default: "json" } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_list_accounts", description: "Read bounded account-slot approval and routing state. This never exposes credentials, home fingerprints, or provider account identifiers, and never approves or changes an account.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 }, response_format: { type: "string", enum: ["json", "markdown"], default: "json" } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_get_architecture", description: "Read the native Usage-max code architecture graph status and bounded statistics. This is source topology only, never provider evidence or authorization.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_query_architecture", description: "Query the native Usage-max code architecture graph with a bounded question. Results are navigation evidence, not live state.", inputSchema: { type: "object", properties: { question: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 40 } }, required: ["question"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_trace_architecture", description: "Trace a bounded directed path between two native Usage-max architecture nodes. No writes or runtime decisions are made.", inputSchema: { type: "object", properties: { from: { type: "string", minLength: 1, maxLength: 200 }, to: { type: "string", minLength: 1, maxLength: 200 } }, required: ["from", "to"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "usage_max_explain_architecture", description: "Explain one native Usage-max architecture node and its bounded connections. Missing or ambiguous nodes remain explicit.", inputSchema: { type: "object", properties: { node: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, required: ["node"], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
const resourceList = [
  { uri: "usage-max://status", name: "Usage-max status", description: "Current read-only readiness, evidence, service, and surface capability state.", mimeType: "application/json" },
  { uri: "usage-max://notices", name: "Usage-max notices", description: "Current pending read-only notices requiring review or delivery.", mimeType: "application/json" },
];

const json = (value) => JSON.stringify(value);
const clampLimit = (value) => Math.min(100, Math.max(1, Number.isFinite(Number(value)) ? Number(value) : 20));
const statusCacheTtlMs = 5000;
let statusCache = null;
const safeObservation = (x) => ({ observationId: x.observationId || null, provider: x.provider || null, surface: x.surface || null, source: x.source || null, accountSlot: x.account?.slot || null, accountApproved: x.account?.approved === true, capturedAt: x.capturedAt || null, providerEventAt: x.providerEventAt || null, authority: x.authority || null, state: x.state || null, freshness: x.freshness || null, confidence: x.confidence || null, model: x.model ? { provider: x.model.provider || null, raw: x.model.raw || x.model.rawId || null, canonical: x.model.canonical || x.model.canonicalId || null, known: x.model.known === true, effort: x.model.effort || null } : null, window: x.window ? { id: x.window.id || null, kind: x.window.kind || null, usedPercentage: x.window.usedPercentage ?? null, resetsAt: x.window.resetsAt || null } : null });
const safeNotice = (x) => ({ noticeId: x.noticeId || null, kind: x.kind || null, surface: x.surface || null, message: x.message || null, createdAt: x.createdAt || null, deliveredAt: x.deliveredAt || null });
const accountRows = () => loadAccounts(path.join(home, ".usage-max", "accounts.json")).accounts.map((x) => ({ slot: x.slot || null, provider: x.provider || null, surfaces: Array.isArray(x.surfaces) ? x.surfaces.slice(0, 20) : [], providerAccountIdPresent: Boolean(x.providerAccountId), approved: x.approved === true, enabled: x.enabled === true, routingEnabled: x.routingEnabled !== false, cooldownUntil: x.cooldownUntil || null, approvedAt: x.approvedAt || null }));
const markdown = (title, rows) => [`## ${title}`, ...rows.map((x) => `- ${x}`)].join("\n");

function readStatus() {
  const now = Date.now(); if (statusCache && now - statusCache.generatedAtMs < statusCacheTtlMs) return statusCache.value;
  const readiness = readinessReport(home, { now }); const compatibility = compatibilityReport(home, { now }); const accounts = accountRows();
  const processHints = readiness.activation.processes; const failures = readFailureHealth(home, { now }); const value = { generatedAt: new Date(now).toISOString(), mode: readiness.mode, enforcementEnabled: false, readyForObservationTrial: readiness.readyForObservationTrial, readyForEnforcement: false, blockers: readiness.blockers, governanceFailures: failures, compatibility: { status: compatibility.status, errors: compatibility.errors, warnings: compatibility.warnings, modelRegistry: compatibility.modelRegistry }, service: readiness.activation.service, startup: readiness.activation.startup, processHints: { sampledAt: processHints.sampledAt, source: processHints.source, available: processHints.available, providers: processHints.providers, ambiguity: processHints.ambiguity, runtimeCapabilities: processHints.runtimeCapabilities, webSurfaces: processHints.webSurfaces }, accounts: { total: accounts.length, approved: accounts.filter((x) => x.approved).length, pendingApproval: accounts.filter((x) => !x.approved).length, enabled: accounts.filter((x) => x.enabled).length, routingEnabled: accounts.filter((x) => x.routingEnabled).length }, approvedAccounts: readiness.approvedAccounts, surfaces: readiness.surfaces.map((x) => ({ surface: x.surface, provider: x.provider, observation: x.effectiveObservation, notification: x.effectiveNotification, authority: x.adapter?.authority || null, reason: x.reason || null })) }; statusCache = { generatedAtMs: now, value }; return value;
}

function readArchitecture() {
  try { const graph = loadArchitectureGraph(root); return { ready: true, schema: graph.schema, generatedAt: graph.generatedAt, stats: graph.stats, confidence: { extracted: graph.edges.filter((x) => x.confidence === "EXTRACTED").length, inferred: graph.edges.filter((x) => x.confidence === "INFERRED").length } }; }
  catch (error) { return { ready: false, reason: "architecture graph unavailable; run `usage-max graph build`", detail: String(error?.message || error) }; }
}

function withArchitecture(fn) { try { return fn(loadArchitectureGraph(root)); } catch (error) { return { ok: false, error: "architecture graph unavailable; run `usage-max graph build`", detail: String(error?.message || error) }; } }

function callTool(name, args = {}) {
  if (name === "usage_max_get_status") return readStatus();
  if (name === "usage_max_list_observations") {
    const rows = readLedger(defaultObservationLedger(home)).filter((x) => !args.surface || x.surface === args.surface).sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0)); const limit = clampLimit(args.limit); const observations = rows.slice(0, limit).map(safeObservation); return { total: rows.length, count: observations.length, hasMore: rows.length > limit, observations };
  }
  if (name === "usage_max_list_notices") {
    const rows = readOutbox(path.join(home, ".usage-max", "notifications.jsonl")).filter((x) => (args.include_delivered || !x.deliveredAt) && (!args.surface || !x.surface || x.surface === args.surface || x.surface === "all")); const limit = clampLimit(args.limit); const notices = rows.slice(-limit).reverse().map(safeNotice); return { total: rows.length, count: notices.length, hasMore: rows.length > limit, notices };
  }
  if (name === "usage_max_get_tasks") {
    const report = taskConsole(home); const tasks = args.task_id ? report.tasks.filter((x) => x.taskId === args.task_id) : report.tasks; return { generatedAt: report.generatedAt, mode: report.mode, stopAvailable: report.stopAvailable, total: tasks.length, tasks };
  }
  if (name === "usage_max_list_accounts") { const accounts = accountRows(); const limit = clampLimit(args.limit); return { total: accounts.length, count: Math.min(limit, accounts.length), hasMore: accounts.length > limit, accounts: accounts.slice(0, limit) }; }
  if (name === "usage_max_get_architecture") return readArchitecture();
  if (name === "usage_max_query_architecture") return withArchitecture((graph) => queryArchitecture(graph, args.question, clampLimit(args.limit)));
  if (name === "usage_max_trace_architecture") return withArchitecture((graph) => shortestArchitecturePath(graph, args.from, args.to));
  if (name === "usage_max_explain_architecture") return withArchitecture((graph) => explainArchitecture(graph, args.node, Math.min(50, clampLimit(args.limit))));
  throw new Error(`unknown tool: ${name}`);
}

function readResource(uri) {
  if (uri === "usage-max://status") return { uri, mimeType: "application/json", text: json(readStatus()) };
  if (uri === "usage-max://notices") {
    const notices = readOutbox(path.join(home, ".usage-max", "notifications.jsonl")).filter((x) => !x.deliveredAt).slice(-100).reverse().map(safeNotice);
    return { uri, mimeType: "application/json", text: json({ total: notices.length, notices }) };
  }
  throw new Error(`unknown resource: ${uri}`);
}

export function dispatch(message) {
  if (!message || message.jsonrpc !== "2.0") return null;
  const reply = (result, error = null) => error ? { jsonrpc: "2.0", id: message.id ?? null, error } : { jsonrpc: "2.0", id: message.id ?? null, result };
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return null;
  if (message.method === "ping") return reply({});
  if (message.method === "initialize") return reply({ protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, instructions: "For assigned work, consult usage_max_get_status at task start, before a provider/model handoff, and after long-running work. Use the architecture tools only for bounded source navigation; their topology is not live evidence, provider allowance, authorization, or enforcement. Treat missing, stale, or unattributed allowance as unavailable; do not infer capacity or enable control from this read-only server.", serverInfo: { name: "usage-max-mcp-server", version: "0.1.0" } });
  if (message.method === "tools/list") return reply({ tools: toolList });
  if (message.method === "resources/list") return reply({ resources: resourceList });
  if (message.method === "resources/read") {
    try { return reply({ contents: [readResource(message.params?.uri)] }); }
    catch (error) { return reply(null, { code: -32001, message: `Usage-max resource read failed: ${String(error?.message || error)}` }); }
  }
  if (message.method === "tools/call") {
    try { const args = message.params?.arguments || {}; const value = callTool(message.params?.name, args); const text = args.response_format === "markdown" ? markdown(message.params.name, Object.entries(value).map(([k, v]) => `${k}: ${typeof v === "string" ? v : json(v)}`)) : json(value); return reply({ content: [{ type: "text", text }], structuredContent: value }); }
    catch (error) { return reply({ content: [{ type: "text", text: `Usage-max read failed: ${String(error?.message || error)}` }], isError: true }); }
  }
  if (message.id !== undefined) return reply(null, { code: -32601, message: `method not found: ${message.method}` });
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => { try { const response = dispatch(JSON.parse(line)); if (response) process.stdout.write(`${json(response)}\n`); } catch (error) { process.stderr.write(`usage-max MCP input error: ${String(error?.message || error)}\n`); } });
