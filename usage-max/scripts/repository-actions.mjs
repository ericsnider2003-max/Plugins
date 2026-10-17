// Explicitly authorized repository mutations. Verification remains read-only;
// callers must opt into each mutation and provide a narrow file scope.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const run = (file, args, cwd, options = {}) => spawnSync(file, args, { cwd, shell: false, encoding: "utf8", timeout: options.timeoutMs || 120000, windowsHide: true });
const relativeSafe = (cwd, value) => {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) return null;
  const rel = path.normalize(value); if (rel === "." || rel.startsWith(`..${path.sep}`) || rel === "..") return null;
  const resolved = path.resolve(cwd, rel); const root = path.resolve(cwd) + path.sep;
  return resolved.startsWith(root) ? rel : null;
};

function refusal(action, reason) { return { action, executed: false, passed: false, reason, evidence: `not executed: ${reason}` }; }

export function executeRepositoryAction(action, { cwd = process.cwd(), allowMutations = false, files = [], commitMessage = "", spawn = run } = {}) {
  if (!allowMutations) return refusal(action, "explicit mutation approval is required");
  if (action === "install") {
    const pkg = path.join(cwd, "package.json"); const lock = ["package-lock.json", "npm-shrinkwrap.json"].find((name) => fs.existsSync(path.join(cwd, name)));
    if (!fs.existsSync(pkg) || !lock) return refusal(action, "package.json and a supported npm lockfile are required");
    const result = spawn("npm", ["ci", "--ignore-scripts"], cwd);
    return { action, executed: true, passed: result.status === 0, evidence: String(result.stdout || result.stderr || "").slice(-2000), command: "npm ci --ignore-scripts" };
  }
  if (action === "commit") {
    if (!String(commitMessage).trim()) return refusal(action, "a non-empty commit message is required");
    const scoped = [...new Set(files.map((file) => relativeSafe(cwd, file)).filter(Boolean))];
    if (!scoped.length || scoped.length !== files.length) return refusal(action, "commit requires an explicit in-repository file list");
    const repo = spawn("git", ["rev-parse", "--show-toplevel"], cwd);
    if (repo.status !== 0) return refusal(action, "target is not a git repository");
    const add = spawn("git", ["add", "--", ...scoped], cwd);
    if (add.status !== 0) return { action, executed: true, passed: false, evidence: String(add.stderr || add.stdout || "git add failed").slice(-2000), files: scoped };
    const commit = spawn("git", ["commit", "-m", String(commitMessage).trim(), "--", ...scoped], cwd);
    return { action, executed: true, passed: commit.status === 0, evidence: String(commit.stdout || commit.stderr || "").slice(-2000), files: scoped, command: "git commit -m <message> -- <files>" };
  }
  return refusal(action, "action is not allowlisted");
}
