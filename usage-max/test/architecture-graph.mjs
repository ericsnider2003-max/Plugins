#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildArchitectureGraph, explainArchitecture, queryArchitecture, shortestArchitecturePath } from "../scripts/architecture-graph.mjs";

const project = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-architecture-"));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-architecture-out-"));
fs.writeFileSync(path.join(project, "provider.mjs"), "export function readProvider() { return true; }\n");
fs.writeFileSync(path.join(project, "readiness.mjs"), "import { readProvider } from './provider.mjs';\nexport function readinessReport() { return readProvider(); }\n");
process.env.USAGE_MAX_GRAPH_DIR = output;
const graph = buildArchitectureGraph(project);
assert.equal(graph.schema, "usage-max.architecture-graph.v1");
assert.ok(graph.nodes.some((x) => x.label === "readinessReport"));
assert.ok(graph.edges.some((x) => x.relation === "imports" && x.confidence === "EXTRACTED"));
assert.equal(shortestArchitecturePath(graph, "readiness.mjs", "provider.mjs").ok, true);
assert.equal(explainArchitecture(graph, "readProvider").ok, true);
assert.equal(queryArchitecture(graph, "provider readiness").ok, true);
const before = graph.stats.cachedFiles; const again = buildArchitectureGraph(project); assert.equal(again.stats.cachedFiles, 2); assert.equal(before, 0);
console.log("native architecture graph tests passed");
