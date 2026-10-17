#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { graphPaths, graphifyPlan, graphifyBinary, runGraphify } from "../scripts/graphify.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-graph-"));
const projectRoot = path.join(home, "project"); const outputRoot = path.join(home, "graph"); fs.mkdirSync(projectRoot);
const p = graphPaths({ projectRoot, outputRoot });
assert.equal(p.graph, path.join(outputRoot, "graphify-out", "graph.json"));
assert.deepEqual(graphifyPlan("build", [], { projectRoot, outputRoot }).map((x) => x.args[0]), ["extract", "cluster-only"]);
assert.deepEqual(graphifyPlan("query", ["provider", "readiness"], { projectRoot, outputRoot })[0].args.slice(0, 3), ["query", "provider", "readiness"]);
assert.equal(graphifyBinary({ GRAPHIFY_BIN: "custom-graphify" }), "custom-graphify");
assert.equal(runGraphify("status", [], { projectRoot, outputRoot }).value.ready, false);
assert.throws(() => graphifyPlan("delete", [], { projectRoot, outputRoot }), /unsupported graph operation/);
console.log("graphify integration tests passed");
