import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const run = (file, args, cwd) => spawnSync(file, args, { cwd, shell: false, encoding: "utf8", timeout: 120000 });
export function runRepositoryCheck(name, { cwd = process.cwd() } = {}) {
  if (name === "tests") {
    const testFile = path.join(cwd, "test", "run.mjs"); if (!fs.existsSync(testFile)) return { passed: false, evidence: "test/run.mjs is not present" };
    const r = run(process.execPath, [testFile], cwd); return { passed: r.status === 0, evidence: (r.stdout || r.stderr || "").slice(-2000) };
  }
  if (name === "lint") {
    const pkg = path.join(cwd, "package.json"); if (!fs.existsSync(pkg)) return { passed: false, evidence: "package.json is not present" };
    try { const p = JSON.parse(fs.readFileSync(pkg, "utf8")); if (!p.scripts?.lint) return { passed: true, evidence: "no lint script configured" }; const r = run("npm", ["run", "lint", "--if-present"], cwd); return { passed: r.status === 0, evidence: (r.stdout || r.stderr || "").slice(-2000) }; } catch { return { passed: false, evidence: "package.json is invalid" }; }
  }
  if (name === "git-clean") {
    const r = run("git", ["status", "--porcelain=v1"], cwd); return { passed: r.status === 0 && !String(r.stdout).trim(), evidence: r.status === 0 ? String(r.stdout).trim() || "working tree clean" : String(r.stderr || "git unavailable").trim() };
  }
  if (name === "commit-present") {
    const r = run("git", ["rev-parse", "HEAD"], cwd); return { passed: r.status === 0 && /^[0-9a-f]{7,}$/i.test(String(r.stdout).trim()), evidence: String(r.stdout || r.stderr).trim() };
  }
  if (name === "install") {
    const pkg = path.join(cwd, "package.json"); if (!fs.existsSync(pkg)) return { passed: false, evidence: "package.json is not present" };
    try { const p = JSON.parse(fs.readFileSync(pkg, "utf8")); const hasLock = fs.existsSync(path.join(cwd, "package-lock.json")) || fs.existsSync(path.join(cwd, "pnpm-lock.yaml")) || fs.existsSync(path.join(cwd, "yarn.lock")); return { passed: Boolean(p.name && hasLock), evidence: p.name && hasLock ? "package and lockfile present; no install performed" : "package metadata or lockfile missing" }; } catch { return { passed: false, evidence: "package.json is invalid" }; }
  }
  if (name === "subagents-closed") {
    const file = path.join(cwd, ".usage-max", "subagents.jsonl"); if (!fs.existsSync(file)) return { passed: true, evidence: "no local subagent registry present" };
    const latest = new Map(); for (const row of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean)) latest.set(row.subagentId || row.id || JSON.stringify(row), row); const active = [...latest.values()].filter((x) => !["closed", "failed", "skipped"].includes(x.state)); return { passed: active.length === 0, evidence: active.length ? `${active.length} subagent record(s) remain open` : "all current subagent records closed" };
  }
  return { passed: false, evidence: `check ${name} is not allowlisted` };
}
