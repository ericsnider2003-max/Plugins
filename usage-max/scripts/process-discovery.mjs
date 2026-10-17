// Read-only host-process discovery. Process presence is not proof of an
// authenticated account, active conversation, or provider allowance.
import { execFileSync } from "node:child_process";

const names = {
  "claude-code": new Set(["claude", "claude.exe"]),
  "codex-cli": new Set(["codex", "codex.exe"]),
  chatgpt: new Set(["chatgpt", "chatgpt.exe"]),
  cowork: new Set(["cowork", "cowork.exe", "cowork-svc.exe"]),
};

function parseTasklist(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.match(/^"([^"]+)"/)?.[1] || null).filter(Boolean).map((x) => x.toLowerCase());
}

function parsePs(text) { return String(text || "").split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean).map((x) => x.toLowerCase().replace(/^.*\//, "")); }
function parseDetails(text) {
  try { const value = JSON.parse(String(text || "")); const rows = Array.isArray(value) ? value : value ? [value] : []; return rows.filter((x) => x && typeof x === "object").map((x) => ({ name: String(x.Name || x.name || "").toLowerCase(), commandLine: String(x.CommandLine || x.commandLine || "") })); } catch { return []; }
}
export function runtimeCapabilities(details = []) {
  const chatgpt = details.filter((x) => /^(chatgpt|chatgpt\.exe)$/.test(x.name));
  const commandLine = chatgpt.map((x) => x.commandLine).join(" ");
  const webmcp = /WebMCPSupport|WebMCP/i.test(commandLine);
  return { chatgptWebMcp: chatgpt.length ? (webmcp ? "enabled" : "not-observed") : "not-running", commandLineObserved: chatgpt.length > 0 };
}

export function discoverProviderProcesses({ platform = process.platform, now = Date.now(), includeCommandLines = false, run = (file, args) => execFileSync(file, args, { encoding: "utf8", windowsHide: true }), runDetails = (file, args) => execFileSync(file, args, { encoding: "utf8", windowsHide: true }) } = {}) {
  let source = platform === "win32" ? "tasklist" : "ps"; let raw = ""; let error = null;
  try { raw = platform === "win32" ? run("tasklist", ["/FO", "CSV", "/NH"]) : run("ps", ["-eo", "comm="]); } catch (e) { error = String(e?.message || e); }
  const processes = platform === "win32" ? parseTasklist(raw) : parsePs(raw); const present = {};
  for (const [surface, candidates] of Object.entries(names)) present[surface] = { running: processes.some((x) => candidates.has(x)), matches: processes.filter((x) => candidates.has(x)) };
  const openaiHostAmbiguous = present.chatgpt.running && present["codex-cli"].running;
  let details = []; let detailError = null;
  if (includeCommandLines && platform === "win32") { try { details = parseDetails(runDetails("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object Name,CommandLine | ConvertTo-Json -Compress"])); } catch (e) { detailError = String(e?.message || e); } }
  return { sampledAt: new Date(now).toISOString(), source, available: !error, error, processes: [...new Set(processes)], providers: present, ambiguity: { openaiHost: openaiHostAmbiguous ? "chatgpt-and-codex-processes-coexist" : null }, runtimeCapabilities: { ...runtimeCapabilities(details), available: includeCommandLines ? !detailError : false, error: detailError }, webSurfaces: { chatgpt: "not-detectable-from-generic-browser-process", cowork: "not-detectable-from-generic-browser-process" } };
}
