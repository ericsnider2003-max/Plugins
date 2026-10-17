import assert from "node:assert/strict";
import { removeLeftovers } from "../codex/scripts/cleanup.mjs";

const orphan = `[hooks.state."usage-max@local-desktop-app-uploads:codex/hooks.json:session_start:0:0"]\ntrusted_hash = "old"\n\n[hooks.state."usage-max@local-desktop-app-uploads:codex/hooks.json:stop:0:0"]\ntrusted_hash = "old2"\n`;
const result = removeLeftovers(orphan);
assert.equal(result.removed.length, 2);
assert.equal(result.next.trim(), "");
assert.deepEqual(result.names, ["local-desktop-app-uploads"]);

const active = `${orphan}\n[plugins."usage-max@local-desktop-app-uploads"]\nenabled = true\n`;
assert.equal(removeLeftovers(active).removed.length, 0, "do not remove trust for an installed upload with a plugin table");
console.log("codex cleanup tests passed");
