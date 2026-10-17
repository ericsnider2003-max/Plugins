import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["scripts/check.mjs"], { encoding: "utf8" });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /All static checks passed/);
console.log("static checks test passed");
