// Copies the Codex side of usage-max to a stable dir (~/.usage-max-codex/bin) so Codex hook paths survive plugin-cache moves.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
export const binDir = (home = process.env.USAGE_MAX_HOME || os.homedir()) => path.join(home, ".usage-max-codex", "bin");
// root = plugin root (dir containing codex/ and .claude-plugin/)
export function syncBin({ root, home, force = false } = {}) {
  try {
    const bin = binDir(home); const vf = path.join(bin, "VERSION");
    const version = String(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version || "0");
    let cur = null; try { cur = fs.readFileSync(vf, "utf8").trim(); } catch {}
    if (!force && cur === version) return { changed: false, version };
    const cx = path.join(root, "codex"); fs.mkdirSync(path.join(bin, "scripts"), { recursive: true });
    for (const f of fs.readdirSync(path.join(cx, "scripts"))) if (f.endsWith(".mjs")) fs.copyFileSync(path.join(cx, "scripts", f), path.join(bin, "scripts", f));
    for (const f of ["memory.mjs", "resume.mjs"]) try { fs.copyFileSync(path.join(root, "scripts", f), path.join(bin, "scripts", f)); } catch {} // project memory is shared with the Claude side
    fs.rmSync(path.join(bin, "skills"), { recursive: true, force: true }); fs.cpSync(path.join(cx, "skills"), path.join(bin, "skills"), { recursive: true });
    fs.copyFileSync(path.join(cx, "AGENTS.usage-max.md"), path.join(bin, "AGENTS.usage-max.md"));
    fs.writeFileSync(vf, version + "\n");
    return { changed: true, version };
  } catch (error) { return { changed: false, error: String(error && error.message || error) }; }
}
