import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runHostRuntime } from "../scripts/host-runtime.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-host-runtime-"));
const result = await runHostRuntime({ home, port: 0, intervalMs: 1000, maxTicks: 1, capture: false });
assert.equal(result.ticks, 1);
assert.equal(JSON.parse(fs.readFileSync(path.join(home, ".usage-max", "service.json"), "utf8")).mode, "observation-only");
assert.equal(fs.existsSync(path.join(home, ".usage-max", "attachment-server.token")), true);
const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-host-runtime-cli-"));
const cli = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "host-runtime.mjs"), "run", "--once", "--no-capture", "--port", "0"], { env: { ...process.env, USAGE_MAX_HOME: cliHome }, encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).mode, "observation-only");
console.log("host runtime tests passed");
