// The pre-0.2 plugin was uploaded to claude.ai ("My Uploads"), which syncs a copy named usage-max@synced into every
// session. If that copy is still enabled next to the marketplace version, every hook runs twice. Detect it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function oldSyncedCopies(home = process.env.USAGE_MAX_HOME || os.homedir(), runningRoot = "") {
  const base = path.join(home, ".claude", "plugins", "synced");
  const found = [];
  let orgs = []; try { orgs = fs.readdirSync(base, { withFileTypes: true }); } catch { return found; }
  for (const o of orgs) {
    if (!o.isDirectory()) continue;
    const dir = path.join(base, o.name, "usage-max");
    let m = null; try { m = JSON.parse(fs.readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf8")); } catch { continue; }
    if (m && m.name === "usage-max" && path.resolve(dir) !== path.resolve(runningRoot || "")) found.push({ dir, version: m.version || "?" });
  }
  return found;
}
export const DISABLE_OLD = "claude plugin disable usage-max@synced   (or remove the upload in claude.ai > Settings > Plugins)";
