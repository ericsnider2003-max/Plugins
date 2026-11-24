// Static guard: every child_process call in shipped scripts must pass `windowsHide: true`.
// Without it, a console child (git, powershell, schtasks, node) spawned by a windowless
// parent (a hook) opens a visible console window on Windows, which flashes on every tool call.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["test", "dist", "node_modules", "replica", "mcpb", ".git"]);
const FUNCS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name)); }
    else if (/\.(mjs|js|cjs)$/.test(e.name)) yield join(dir, e.name);
  }
}

// Returns the text of the balanced (...) starting at the "(" at index i, skipping strings/comments/templates.
function callArgs(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === "`") {
      for (j++; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++;
    } else if (c === "/" && src[j + 1] === "/") { while (j < src.length && src[j] !== "\n") j++; }
    else if (c === "/" && src[j + 1] === "*") { j = src.indexOf("*/", j + 2); if (j < 0) break; j++; }
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

export function findViolations(file, src) {
  if (!/child_process/.test(src)) return [];
  // Names bound from child_process (including `import * as cp` / `cp.spawn`).
  const names = new Map(); // local name -> true
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g))
    for (const part of m[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      if (FUNCS.includes(orig)) names.set(local || orig, true);
    }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+import\(|require\()\s*["'](?:node:)?child_process["']/g))
    for (const part of m[1].split(",")) {
      const [orig, local] = part.trim().split(/\s*:\s*/);
      if (FUNCS.includes(orig)) names.set(local || orig, true);
    }
  const nsNames = [];
  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*["'](?:node:)?child_process["']/g)) nsNames.push(m[1]);
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s*["'](?:node:)?child_process["']/g)) nsNames.push(m[1]);
  const out = [];
  const check = (idx, label) => {
    const open = src.indexOf("(", idx);
    const args = callArgs(src, open);
    if (!/windowsHide\s*:\s*true/.test(args)) {
      const line = src.slice(0, idx).split("\n").length;
      out.push(`${file}:${line} ${label}(...) lacks windowsHide: true`);
    }
  };
  for (const [name] of names)
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w.$])${name}\s*\(`, "g"))) {
      const before = src.slice(Math.max(0, m.index - 20), m.index);
      if (/(?:function|import|from)\s*$/.test(before)) continue; // declarations
      check(m.index, name);
    }
  for (const ns of nsNames)
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$])${ns}\.(${FUNCS.join("|")})\s*\(`, "g"))) check(m.index, `${ns}.${m[1]}`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Self-test: the scanner must flag a bare call and accept a hidden one.
  assert.equal(findViolations("x.mjs", `import { spawnSync } from "node:child_process";\nspawnSync("git", ["status"], { encoding: "utf8" });`).length, 1);
  assert.equal(findViolations("x.mjs", `import { spawnSync } from "node:child_process";\nspawnSync("git", ["status"], { encoding: "utf8", windowsHide: true });`).length, 0);
  assert.equal(findViolations("x.mjs", `import cp from "child_process";\ncp.execSync("ls");`).length, 1);

  const violations = [];
  for (const file of walk(root)) violations.push(...findViolations(relative(root, file).replaceAll("\\", "/"), readFileSync(file, "utf8")));
  assert.equal(violations.length, 0, `child_process calls without windowsHide: true:\n${violations.join("\n")}`);
  console.log("windows-hide static test passed");
}
