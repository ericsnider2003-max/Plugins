#!/usr/bin/env node
// Optional, read-only Graphify integration for Usage-max architecture queries.
// Graphify stays an external dependency: this adapter never imports it, sends
// project data to a provider, or mixes graph state with Usage-max account data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.USAGE_MAX_HOME || os.homedir();
const safeSlug = (value) => String(value || "project").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "project";
const defaultProject = () => path.resolve(process.env.USAGE_MAX_GRAPH_ROOT || root);
const defaultOutput = (projectRoot) => process.env.USAGE_MAX_GRAPH_DIR || path.join(home, ".usage-max", "graphs", safeSlug(projectRoot));

export function graphPaths({ projectRoot = defaultProject(), outputRoot = defaultOutput(projectRoot) } = {}) {
  const output = path.resolve(outputRoot);
  return { projectRoot: path.resolve(projectRoot), outputRoot: output, graph: path.join(output, "graphify-out", "graph.json") };
}

export function graphifyBinary(env = process.env) {
  return env.GRAPHIFY_BIN || (process.platform === "win32" ? "graphify.exe" : "graphify");
}

export function graphifyPlan(operation, args = [], options = {}) {
  const p = graphPaths(options);
  if (operation === "build") return [
    { args: ["extract", p.projectRoot, "--code-only", "--no-viz", "--no-cluster", "--out", p.outputRoot], cwd: p.projectRoot },
    { args: ["cluster-only", p.outputRoot, "--no-viz", "--no-label"], cwd: p.projectRoot },
  ];
  if (operation === "query") return [{ args: ["query", ...args, "--graph", p.graph], cwd: p.projectRoot }];
  if (operation === "path") return [{ args: ["path", ...args, "--graph", p.graph], cwd: p.projectRoot }];
  if (operation === "explain") return [{ args: ["explain", ...args, "--graph", p.graph], cwd: p.projectRoot }];
  if (operation === "god-nodes") return [{ args: ["god-nodes", ...args, "--graph", p.graph], cwd: p.projectRoot }];
  throw new Error(`unsupported graph operation: ${operation}`);
}

function graphStatus(options = {}) {
  const p = graphPaths(options);
  if (!fs.existsSync(p.graph)) return { ready: false, graph: p.graph, reason: "graph is missing; run `usage-max graph build`" };
  try {
    const value = JSON.parse(fs.readFileSync(p.graph, "utf8"));
    return { ready: true, graph: p.graph, nodes: Array.isArray(value.nodes) ? value.nodes.length : 0, edges: Array.isArray(value.links) ? value.links.length : Array.isArray(value.edges) ? value.edges.length : 0, schemaVersion: value.graph?.schema_version || value.graph?.schemaVersion || null, graphifyVersion: value.graph?.graphify_version || value.graph?.graphifyVersion || null };
  } catch (error) { return { ready: false, graph: p.graph, reason: `graph is unreadable: ${String(error?.message || error)}` }; }
}

export function runGraphify(operation = "status", args = [], options = {}) {
  if (operation === "status") return { status: 0, value: graphStatus(options) };
  const plan = graphifyPlan(operation, args, options); const bin = graphifyBinary(options.env || process.env);
  for (const step of plan) {
    const result = spawnSync(bin, step.args, { cwd: step.cwd, stdio: "inherit", shell: false, env: { ...process.env, ...(options.env || {}), GRAPHIFY_BACKEND: "none" } });
    if (result.error) return { status: 1, error: `Graphify is unavailable (${bin}): ${result.error.message}` };
    if (result.status !== 0) return { status: result.status ?? 1, error: `Graphify ${operation} failed with exit code ${result.status ?? 1}` };
  }
  return { status: 0, value: graphStatus(options) };
}

function usage() {
  console.log("usage-max graph status|build|query <question>|path <from> <to>|explain <node>|god-nodes [--top N]");
  console.log("Environment: GRAPHIFY_BIN overrides the CLI; USAGE_MAX_GRAPH_ROOT selects the scan root; USAGE_MAX_GRAPH_DIR selects the external output directory.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [operation = "status", ...args] = process.argv.slice(2);
  if (operation === "help" || operation === "--help") { usage(); process.exit(0); }
  try {
    const result = runGraphify(operation, args);
    if (result.value) console.log(JSON.stringify(result.value, null, 2));
    if (result.error) console.error(`usage-max graph: ${result.error}`);
    process.exit(result.status);
  } catch (error) { console.error(`usage-max graph: ${String(error?.message || error)}`); process.exit(1); }
}
