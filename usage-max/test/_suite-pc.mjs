import { spawnSync } from "node:child_process";
const list = ["usage-max/scripts/check.mjs","usage-max/test/run.mjs","usage-max/test/new.mjs","usage-max/test/guard.mjs","usage-max/test/memory.mjs","usage-max/test/fix.mjs","usage-max/test/fix-w.mjs","usage-max/test/fix-x.mjs","usage-max/test/fix-y.mjs","usage-max/test/fix-z.mjs","usage-max/test/fix-m.mjs","usage-max/test/fix-s.mjs","usage-max/test/win.mjs","usage-max/test/governance.mjs","usage-max/test/work-cli.mjs","usage-max/test/local-route.mjs","usage-max/codex/test/run.mjs"];
let bad = [];
for (const f of list) { const r = spawnSync(process.execPath, [f], { encoding: "utf8", windowsHide: true, timeout: 600000 }); const code = r.status; console.log(`SUITE ${f} exit=${code}`); if (code !== 0) { bad.push(f); console.log((r.stdout + r.stderr).split("\n").filter((l) => /FAIL|Error|not found|Cannot/i.test(l)).slice(0, 6).join("\n")); } }
console.log(bad.length ? "SUITE FAILED: " + bad.join(", ") : "SUITE ALL PASS");
process.exit(bad.length ? 1 : 0);
