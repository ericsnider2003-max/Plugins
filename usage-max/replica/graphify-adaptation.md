# Graphify adaptation for Usage-max

## Decision

Build the useful Graphify ideas into Usage-max as a native, deterministic architecture index. Do not copy its Python implementation into the Node plugin and do not treat the graph as provider evidence, account state, task state, or authorization.

The local `rea` repository is a separate reverse-engineering MCP. Its useful pattern is the boundary discipline: evidence-producing tools are explicit, read-only by default, and must report limitations. Usage-max therefore keeps Graphify behind a small Node adapter and leaves the existing read-only Usage-max MCP surface authoritative for live state.

## First integration

- `.graphifyignore` excludes runtime data, audit output, filing state, and generated artifacts.
- `usage-max graph build` uses the native Node scanner: code-only, deterministic, no LLM backend, and no visualization requirement.
- Native graph output is stored outside the project by default under `~/.usage-max/graphs/<project>/`.
- `usage-max graph query`, `path`, `explain`, and `god-nodes` run locally and remain read-only.
- The existing Graphify checkout is retained only as a comparison oracle for extraction quality and future parity tests; Usage-max does not require Python, Graphify, or `GRAPHIFY_BIN` at runtime.
- The Usage-max MCP server exposes bounded architecture status, query, trace, and explain tools alongside the existing evidence tools.

## Safety boundary

The native graph is an architecture/navigation aid. It cannot establish provider authority, allowance freshness, account approval, task completion, or enforcement readiness. Graph answers must never be used as quota evidence or as permission to launch a worker. Only source topology is indexed; semantic extraction and runtime-state ingestion are intentionally excluded.

## Evidence

On 2026-10-17, the external Graphify checkout was isolated under `Skills/_external/graphify`, installed in its own Python 3.12 virtual environment, and used as a comparison oracle. It produced a graph with 1,974 nodes and 4,995 edges before clustering, then 112 communities. The native Usage-max graph produced 1,478 nodes and 2,543 edges from 253 source files, and native queries passed against a fixture graph and the project graph.

## Upstream and licensing

The inspected Graphify-Labs checkout is Apache-2.0 with a bundled MIT notice and uses the package name `graphifyy`. Usage-max does not vendor or require it. REA remains MIT-licensed and is used only as an architectural reference in this adaptation.
