// The checked local-model route: the owner's workbench MCP server (Qwen on a second PC, every code result verified by tests).
// Available = the server file exists AND importing it and calling wb_status returns without an err within the timeout.
// File: env USAGE_MAX_WORKBENCH, else ~/.claude/workpc/wb-mcp.mjs. Nothing here starts, installs or changes anything.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { pathToFileURL } from "node:url";
export const workbenchFile = () => process.env.USAGE_MAX_WORKBENCH || path.join(os.homedir(), ".claude", "workpc", "wb-mcp.mjs");
export async function workbenchAvailable({ file = workbenchFile(), timeoutMs = 15000 } = {}) {
  if (!fs.existsSync(file)) return { available: false, file, why: `no workbench at ${file}` };
  let timer;
  try {
    const run = (async () => { const m = await import(pathToFileURL(file).href); return await m.call("wb_status", {}); })();
    run.catch(() => {});
    const r = await Promise.race([run, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`wb_status did not answer within ${timeoutMs} ms`)), timeoutMs); })]);
    if (r && r.err) return { available: false, file, why: "wb_status: " + String(r.err).slice(0, 200) };
    return { available: true, file };
  } catch (e) { return { available: false, file, why: String(e && e.message).slice(0, 200) }; }
  finally { clearTimeout(timer); }
}
