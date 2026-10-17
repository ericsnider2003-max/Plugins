#!/usr/bin/env node
// Build a clean MCPB/MCP desktop-extension bundle without copying local state.
// The bundle contains only the read-only MCP bridge and its transitive source
// dependencies, not unrelated command or mutation modules.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceManifest = path.join(root, "mcpb", "manifest.json");
const args = process.argv.slice(2); const outIndex = args.indexOf("--out");
const output = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : path.join(root, "dist", "usage-max.mcpb");
const stageOnly = args.includes("--stage-only"); const stage = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-mcpb-"));
const relativeImport = /(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g;
function resolveModule(from, reference) {
  const base = path.resolve(path.dirname(from), reference);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}
function moduleClosure(entry) {
  const seen = new Set(); const pending = [entry];
  while (pending.length) { const file = pending.pop(); if (!file || seen.has(file)) continue; seen.add(file); const source = fs.readFileSync(file, "utf8"); for (const match of source.matchAll(relativeImport)) { const next = resolveModule(file, match[1]); if (next && next.startsWith(root)) pending.push(next); } }
  return [...seen];
}
function copyFile(file) { const relative = path.relative(root, file); const target = path.join(stage, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target); }
function copyTree(relative) { const source = path.join(root, relative); const target = path.join(stage, relative); fs.cpSync(source, target, { recursive: true, filter: (entry) => !/[\\/]\.usage-max(?:[\\/]|$)/.test(entry) && !/[\\/]node_modules(?:[\\/]|$)/.test(entry) }); }
fs.copyFileSync(sourceManifest, path.join(stage, "manifest.json"));
const modules = moduleClosure(path.join(root, "mcp", "usage-max-mcp-server.mjs")); for (const file of modules) copyFile(file);
for (const relative of ["contracts", "data"]) copyTree(relative);
const report = { mode: stageOnly ? "stage-only" : "mcpb", enforcementEnabled: false, moduleCount: modules.length, includedModules: modules.map((file) => path.relative(root, file)).sort() };
if (stageOnly) { console.log(JSON.stringify({ stage, ...report })); }
else { fs.mkdirSync(path.dirname(output), { recursive: true }); const result = spawnSync("tar", ["-a", "-c", "-f", output, "-C", stage, "."], { encoding: "utf8", windowsHide: true }); if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "MCPB archive creation failed").trim()); console.log(JSON.stringify({ bundle: output, ...report })); }
