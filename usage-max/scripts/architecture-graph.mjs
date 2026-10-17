#!/usr/bin/env node
// Native, deterministic architecture graph for Usage-max.
// This is intentionally code-only: no model calls, no runtime state, no secrets.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "./meter.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.USAGE_MAX_HOME || os.homedir();
export const GRAPH_SCHEMA = "usage-max.architecture-graph.v1";
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".ps1"]);
const IGNORED_DIRS = new Set([".git", ".filing", "node_modules", "roundtrip", "data", "graphify-out", "dist", "build", ".venv"]);
const IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(|import\s*\()(['"])([^'"\n]+)\1/g;
const FUNCTION_RE = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?(?:async\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^\n]*\)|[A-Za-z_$][\w$]*)\s*=>|(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g;

const posix = (value) => String(value).split(path.sep).join("/");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const safeSlug = (value) => String(value || "project").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "project";
const graphDir = (projectRoot = root) => path.resolve(process.env.USAGE_MAX_GRAPH_DIR || path.join(home, ".usage-max", "graphs", safeSlug(projectRoot), "native"));
const graphFile = (projectRoot = root) => path.join(graphDir(projectRoot), "graph.json");
const cacheFile = (projectRoot = root) => path.join(graphDir(projectRoot), "cache.json");

function readIgnoreFile(projectRoot) {
  const file = path.join(projectRoot, ".graphifyignore");
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")).map((x) => x.replace(/\\/g, "/").replace(/\/+$|^\/+|\*+$/g, "")); } catch { return []; }
}

export function collectSourceFiles(projectRoot = root) {
  const ignored = [...IGNORED_DIRS, ...readIgnoreFile(projectRoot).map((x) => x.replace(/\/$/, ""))]; const files = [];
  const walk = (dir) => { let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) { const full = path.join(dir, entry.name); const rel = posix(path.relative(projectRoot, full)); if (entry.isDirectory()) { if (!ignored.some((x) => rel === x || rel.startsWith(`${x}/`) || entry.name === x)) walk(full); } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full); }
  }; walk(projectRoot); return files.sort();
}

function lineOf(text, index) { return text.slice(0, index).split("\n").length; }
function fileId(rel) { return `file:${rel}`; }
function symbolId(rel, name) { return `symbol:${rel}:${name}`; }
function resolveImport(projectRoot, sourceFile, specifier) {
  if (!specifier.startsWith(".")) return null; const base = path.resolve(path.dirname(sourceFile), specifier); const candidates = [base, ...[".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".ps1"].map((ext) => base + ext), ...["index.mjs", "index.js", "index.ts", "index.py"].map((name) => path.join(base, name))];
  for (const candidate of candidates) { try { if (fs.statSync(candidate).isFile()) return posix(path.relative(projectRoot, candidate)); } catch (error) { void error; } } return null;
}

export function extractFile(projectRoot, file) {
  const rel = posix(path.relative(projectRoot, file)); let source; try { source = fs.readFileSync(file, "utf8"); } catch (error) { return { rel, hash: null, nodes: [], edges: [], error: String(error?.message || error) }; }
  const fileNode = { id: fileId(rel), label: rel, kind: "file", sourceFile: rel, sourceLocation: "L1" }; const nodes = [fileNode]; const edges = []; const symbols = [];
  let m; while ((m = FUNCTION_RE.exec(source))) { const name = m[1] || m[2] || m[3]; const id = symbolId(rel, name); symbols.push(name); nodes.push({ id, label: name, kind: "symbol", sourceFile: rel, sourceLocation: `L${lineOf(source, m.index)}` }); edges.push({ source: fileNode.id, target: id, relation: "contains", confidence: "EXTRACTED", sourceFile: rel, sourceLocation: `L${lineOf(source, m.index)}` }); }
  while ((m = IMPORT_RE.exec(source))) { const target = resolveImport(projectRoot, file, m[2]); if (target) edges.push({ source: fileNode.id, target: fileId(target), relation: "imports", confidence: "EXTRACTED", sourceFile: rel, sourceLocation: `L${lineOf(source, m.index)}` }); }
  for (const name of [...new Set(symbols)]) { const escaped = name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"); const calls = source.match(new RegExp(`\\b${escaped}\\s*\\(`, "g")); if (calls && calls.length > 1) edges.push({ source: fileNode.id, target: symbolId(rel, name), relation: "references", confidence: "INFERRED", sourceFile: rel, sourceLocation: `L${lineOf(source, source.indexOf(`${name}(`))}` }); }
  return { rel, hash: hash(source), nodes, edges };
}

function loadCache(projectRoot) { try { const v = JSON.parse(fs.readFileSync(cacheFile(projectRoot), "utf8")); return v && v.version === 1 && v.files && typeof v.files === "object" ? v : { version: 1, files: {} }; } catch { return { version: 1, files: {} }; } }
export function buildArchitectureGraph(projectRoot = root) {
  const resolvedRoot = path.resolve(projectRoot); const files = collectSourceFiles(resolvedRoot); const old = loadCache(resolvedRoot); const next = { version: 1, files: {} }; const extractions = [];
  for (const file of files) { const rel = posix(path.relative(resolvedRoot, file)); let source; try { source = fs.readFileSync(file, "utf8"); } catch { continue; } const digest = hash(source); const cached = old.files[rel]; const extraction = cached?.hash === digest ? cached.extraction : extractFile(resolvedRoot, file); next.files[rel] = { hash: digest, extraction }; extractions.push(extraction); }
  const nodes = new Map(); const edgeMap = new Map(); for (const extraction of extractions) { for (const node of extraction.nodes) nodes.set(node.id, node); for (const edge of extraction.edges) edgeMap.set(`${edge.source}|${edge.target}|${edge.relation}`, edge); }
  const graph = { schema: GRAPH_SCHEMA, version: 1, generatedAt: new Date().toISOString(), sourceRoot: resolvedRoot, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edgeMap.values()].sort((a, b) => `${a.source}|${a.target}`.localeCompare(`${b.source}|${b.target}`)), stats: { files: files.length, nodes: nodes.size, edges: edgeMap.size, cachedFiles: files.filter((f) => old.files[posix(path.relative(resolvedRoot, f))]?.hash === next.files[posix(path.relative(resolvedRoot, f))]?.hash).length } };
  writeJsonAtomic(cacheFile(resolvedRoot), next); writeJsonAtomic(graphFile(resolvedRoot), graph); return graph;
}

export function loadArchitectureGraph(projectRoot = root) { return JSON.parse(fs.readFileSync(graphFile(projectRoot), "utf8")); }
const textOf = (node) => `${node.label || ""} ${node.sourceFile || ""}`.toLowerCase();
function adjacent(graph, id, direction = "both") { return graph.edges.filter((e) => direction !== "in" && e.source === id).map((e) => [e.target, e]).concat(graph.edges.filter((e) => direction !== "out" && e.target === id).map((e) => [e.source, e])); }
function candidates(graph, term) { const q = String(term || "").toLowerCase(); return graph.nodes.filter((n) => textOf(n).includes(q)).sort((a, b) => (b.kind === "symbol") - (a.kind === "symbol") || a.label.localeCompare(b.label)); }
export function explainArchitecture(graph, term, limit = 20) { const matches = candidates(graph, term); if (!matches.length) return { ok: false, error: "no matching architecture node" }; const node = matches[0]; return { ok: true, node, matches: matches.slice(0, 10), connections: adjacent(graph, node.id).slice(0, limit).map(([id, edge]) => ({ edge, node: graph.nodes.find((x) => x.id === id) || { id } })) }; }
export function queryArchitecture(graph, question, limit = 40) { const terms = String(question || "").toLowerCase().split(/[^a-z0-9_$.-]+/).filter((x) => x.length >= 3); const seeds = graph.nodes.filter((n) => terms.some((term) => textOf(n).includes(term))).slice(0, 12); const seen = new Set(seeds.map((x) => x.id)); const queue = [...seeds]; const edges = []; while (queue.length && seen.size < limit) { const current = queue.shift(); for (const [id, edge] of adjacent(graph, current.id)) { edges.push(edge); if (!seen.has(id)) { seen.add(id); const node = graph.nodes.find((x) => x.id === id); if (node) queue.push(node); } if (edges.length >= limit * 2) break; } } return { ok: seeds.length > 0, question, seeds, nodes: [...seen].map((id) => graph.nodes.find((x) => x.id === id)).filter(Boolean).slice(0, limit), edges: edges.slice(0, limit * 2) }; }
export function shortestArchitecturePath(graph, from, to) { const starts = candidates(graph, from); const ends = new Set(candidates(graph, to).map((x) => x.id)); if (!starts.length || !ends.size) return { ok: false, error: "one or both architecture nodes were not found" }; const queue = starts.map((node) => ({ id: node.id, path: [node.id], edges: [] })); const seen = new Set(starts.map((x) => x.id)); while (queue.length) { const item = queue.shift(); if (ends.has(item.id)) return { ok: true, nodes: item.path.map((id) => graph.nodes.find((x) => x.id === id)).filter(Boolean), edges: item.edges }; for (const [id, edge] of adjacent(graph, item.id, "out")) if (!seen.has(id)) { seen.add(id); queue.push({ id, path: [...item.path, id], edges: [...item.edges, edge] }); } } return { ok: false, error: "no directed path found" }; }
export function godNodes(graph, limit = 10) { const degree = new Map(graph.nodes.map((x) => [x.id, 0])); for (const edge of graph.edges) { degree.set(edge.source, (degree.get(edge.source) || 0) + 1); degree.set(edge.target, (degree.get(edge.target) || 0) + 1); } return [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, degree]) => ({ degree, node: graph.nodes.find((x) => x.id === id) })); }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [operation = "status", ...args] = process.argv.slice(2); const project = process.env.USAGE_MAX_GRAPH_ROOT || root;
  try { if (operation === "build") console.log(JSON.stringify(buildArchitectureGraph(project), null, 2)); else if (operation === "status") console.log(JSON.stringify({ graph: graphFile(project), ready: fs.existsSync(graphFile(project)), ...(fs.existsSync(graphFile(project)) ? { stats: loadArchitectureGraph(project).stats } : {}) }, null, 2)); else { const graph = loadArchitectureGraph(project); const result = operation === "query" ? queryArchitecture(graph, args.join(" ")) : operation === "path" ? shortestArchitecturePath(graph, args[0], args[1]) : operation === "explain" ? explainArchitecture(graph, args.join(" ")) : operation === "god-nodes" ? godNodes(graph) : null; if (!result) throw new Error("usage: architecture-graph build|status|query|path|explain|god-nodes"); console.log(JSON.stringify(result, null, 2)); } } catch (error) { console.error(`architecture graph: ${String(error?.message || error)}`); process.exit(1); }
}
