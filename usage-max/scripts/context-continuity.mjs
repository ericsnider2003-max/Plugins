// Deterministic handoff/resume evidence. It never carries credentials or
// message bodies; it records hashes and acceptance identifiers only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const jsonDigest = (value) => digest(stable(value));
function safeRelative(root, value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) return null;
  const rel = path.normalize(value); if (rel === ".." || rel.startsWith(`..${path.sep}`)) return null;
  const full = path.resolve(root, rel); const base = path.resolve(root) + path.sep;
  return full.startsWith(base) ? rel : null;
}

export function captureContinuity({ workspaceRoot, files = [], checkpoint = null, effects = [], acceptanceCriteria = [] } = {}) {
  if (!workspaceRoot) return null;
  const entries = files.map((file) => {
    const relative = safeRelative(workspaceRoot, file); if (!relative) return { path: String(file), present: false, reason: "path outside workspace" };
    const full = path.join(workspaceRoot, relative);
    try { return { path: relative, present: true, digest: digest(fs.readFileSync(full)) }; }
    catch { return { path: relative, present: false, reason: "file unavailable" }; }
  });
  return { workspaceRootHint: path.basename(path.resolve(workspaceRoot)), files: entries, checkpoint: checkpoint ? { version: checkpoint.version, digest: checkpoint.digest } : null, effectsDigest: jsonDigest(effects), acceptanceCriteria: [...new Set(acceptanceCriteria.map(String))], capturedAt: new Date().toISOString() };
}

export function verifyContinuity(pack, { workspaceRoot, files = null, checkpoint = null, effects = null, acceptanceCriteria = null } = {}) {
  const expected = pack?.context;
  if (!expected) return { ready: false, reason: "handoff context evidence is missing", mismatches: ["context"] };
  const mismatches = [];
  if (checkpoint && expected.checkpoint && (checkpoint.version !== expected.checkpoint.version || checkpoint.digest !== expected.checkpoint.digest)) mismatches.push("checkpoint");
  if (effects && jsonDigest(effects) !== expected.effectsDigest) mismatches.push("effects");
  if (acceptanceCriteria && JSON.stringify([...new Set(acceptanceCriteria.map(String))]) !== JSON.stringify(expected.acceptanceCriteria || [])) mismatches.push("acceptance-criteria");
  if (workspaceRoot && Array.isArray(expected.files)) {
    const selected = files || expected.files.map((x) => x.path);
    for (const file of selected) {
      const entry = expected.files.find((x) => x.path === file); const relative = safeRelative(workspaceRoot, file);
      if (!entry || !relative) { mismatches.push(`file:${file}`); continue; }
      try { if (!entry.present || digest(fs.readFileSync(path.join(workspaceRoot, relative))) !== entry.digest) mismatches.push(`file:${file}`); }
      catch { mismatches.push(`file:${file}`); }
    }
  }
  return { ready: mismatches.length === 0, reason: mismatches.length ? "handoff context diverged" : "handoff context matches", mismatches };
}
