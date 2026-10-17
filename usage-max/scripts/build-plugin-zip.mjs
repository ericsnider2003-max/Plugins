#!/usr/bin/env node
// Build the uploadable plugin archive from the current source tree.
// Usage: node scripts/build-plugin-zip.mjs [--out path/to/usage-max-plugin.zip]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const out = path.resolve(root, outArg >= 0 && args[outArg + 1] ? args[outArg + 1] : `../usage-max-plugin-${readVersion()}.zip`);
const packagePaths = [
  ".claude-plugin", ".codex-plugin", "agents", "codex", "commands", "hooks", "mcp", "mcpb",
  "playbooks", "profiles", "replica", "scripts", "skills", "data", "chat-preferences.md", "README.md",
  "plugin.json", "mcp.json", ".mcp.json",
];

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version;
}

function fail(message) { throw new Error(message); }

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-plugin-"));
try {
  for (const relative of packagePaths) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) fail(`required package path is missing: ${relative}`);
    fs.cpSync(source, path.join(stage, relative), { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tempOut = `${out}.tmp-${process.pid}`;
  try { fs.rmSync(tempOut, { force: true }); } catch {}
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "Compress-Archive", "-Path", `${stage}\\*`, "-DestinationPath", tempOut, "-CompressionLevel", "Optimal"], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-q", "-r", tempOut, "."], { cwd: stage, stdio: "inherit" });
  }
  const required = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "mcp/usage-max-mcp-server.mjs", "mcpb/manifest.json", "scripts/architecture-graph.mjs", "scripts/failure-health.mjs", "data/model-registry.json"];
  const archiveList = process.platform === "win32"
    ? execFileSync("tar", ["-tf", tempOut], { encoding: "utf8" }).split(/\r?\n/)
    : execFileSync("unzip", ["-Z1", tempOut], { encoding: "utf8" }).split(/\r?\n/);
  const missing = required.filter((item) => !archiveList.includes(item));
  if (missing.length) fail(`archive is missing: ${missing.join(", ")}`);
  fs.rmSync(out, { force: true });
  fs.renameSync(tempOut, out);
  console.log(JSON.stringify({ archive: out, version: readVersion(), entries: archiveList.filter(Boolean).length }));
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
