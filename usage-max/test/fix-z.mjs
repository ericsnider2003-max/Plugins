// Tests for the reports batch Z (blocks, savings pace and trust labels, cache-break detector, plugin-diet checks).
// One block per id. `node test/fix-z.mjs FEAT-REPORT-3` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umz-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const sandbox = () => { const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex"); return home; };
const run = (script, args, home, extra = {}) => spawnSync("node", [path.join(root, script), ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), ...extra } });
const H = 36e5, MIN = 60000, close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
// one hour-aligned anchor a day or so in the past (blocks start on whole UTC hours, so the expected starts are exact in every time zone)
const A = Math.floor((Date.now() - 30 * H) / H) * H;
const rec = (id, model, ts, usage) => JSON.stringify({ type: "assistant", timestamp: new Date(ts).toISOString(), message: { id, model, usage } }) + "\n";
const SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";
const plain = (out = 1000) => ({ input_tokens: 1000, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }); // sonnet-5-5: 1000 in * $2/M + 1000 out * $10/M = $0.012
const writeProj = (home, name, files) => { const d = path.join(home, ".claude", "projects", name); fs.mkdirSync(d, { recursive: true }); for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body); return path.join(home, ".claude", "projects"); };

await t("FEAT-REPORT-1", "blocks: 5-hour boundaries (end excluded), gaps over 5 hours start a new block", async () => {
  const home = sandbox(), B = await imp("scripts/blocks.mjs");
  const times = [A + 30 * MIN, A + 4 * H + 59 * MIN, A + 5 * H, A + 9 * H + 59 * MIN, A + 16 * H];
  const dir = writeProj(home, "p1", { "s.jsonl": times.map((ts, i) => rec("m" + i, SONNET, ts, plain())).join("") });
  const r = await B.blocksReport({ dir, days: 7, now: A + 22 * H });
  assert.deepEqual(r.blocks.map((b) => b.messages), [2, 2, 1], "message exactly at the block end opens the next block; 4h59m after the start stays");
  assert.deepEqual(r.blocks.map((b) => b.start), [A, A + 5 * H, A + 16 * H], "start = first message floored to the hour");
  assert.deepEqual(r.blocks.map((b) => b.end), [A + 5 * H, A + 10 * H, A + 21 * H]);
  assert.equal(r.blocks.some((b) => b.active), false, "now is after the last block");
  close(r.blocks[0].cost, 0.024, "block cost"); assert.equal(r.blocks[0].input, 2000); assert.equal(r.blocks[0].output, 2000); assert.deepEqual(r.blocks[0].models, [SONNET]);
  // a gap of more than 5 hours starts a new block even before the clock would have ended the old one
  const g = B.buildBlocks([{ t: A + 4 * H, model: SONNET, u: { input: 1, output: 1, created: 0, read: 0 }, cost: 0.1 }, { t: A + 9 * H + 1, model: SONNET, u: { input: 1, output: 1, created: 0, read: 0 }, cost: 0.1 }], { now: A + 30 * H });
  assert.equal(g.length, 2); assert.equal(g[1].start, A + 9 * H);
  const text = B.formatBlocks(r); assert.match(text, /MEASURED/); assert.match(text, /LIST-PRICE/); assert.match(text, /3 block\(s\), 5 messages/); assert.doesNotMatch(text, /ACTIVE/);
});

await t("FEAT-REPORT-2", "blocks: a message copied into a second file (and repeated per content block) counts once, at its largest output", async () => {
  const home = sandbox(); const now = Date.now(), ts = now - H;
  const dir = writeProj(home, "p1", {
    "a.jsonl": rec("dup", SONNET, ts, plain(500)) + rec("dup", SONNET, ts, plain(500)) + rec("solo", SONNET, ts + MIN, plain()),
    "b.jsonl": rec("dup", SONNET, ts, plain(900))
  });
  const r = run("scripts/blocks.mjs", ["--projects-dir", dir, "--days", "1", "--json"], home); assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout); assert.equal(j.messages, 2, "two distinct messages, not four");
  assert.equal(j.blocks.reduce((a, b) => a + b.messages, 0), 2); assert.equal(j.blocks.reduce((a, b) => a + b.output, 0), 900 + 1000, "the larger copy wins");
  close(j.blocks.reduce((a, b) => a + b.cost, 0), (1000 * 2 + 900 * 10) / 1e6 + 0.012, "cost counted once");
});

await t("FEAT-REPORT-3", "blocks: the active block shows burn rates and a projection that is labelled as a projection", async () => {
  const home = sandbox(), B = await imp("scripts/blocks.mjs"); const now = A + 2 * H;
  const times = [A + 30 * MIN, ...[36, 40, 45, 50, 54, 57].map((m) => A + H + m * MIN)]; // 1 message early, 6 inside the last 30 minutes (> A+1h30m)
  const dir = writeProj(home, "p1", { "s.jsonl": times.map((ts, i) => rec("m" + i, SONNET, ts, plain())).join("") });
  const r = await B.blocksReport({ dir, days: 7, now }); const b = r.blocks[0];
  assert.equal(r.blocks.length, 1); assert.equal(b.active, true); close(b.cost, 0.084, "so far");
  close(b.burn.perHourSoFar, 0.084 / 1.5, "block-so-far rate = cost / hours since the first message");
  close(b.burn.last30MinPerHour, 0.072 / 0.5, "last 30 minutes rate"); assert.equal(b.burn.last30MinMessages, 6);
  close(b.burn.hoursLeft, 3, "hours left"); close(b.burn.projection.atBlockPace, 0.084 + (0.084 / 1.5) * 3, "projection at block pace"); close(b.burn.projection.atRecentPace, 0.084 + 0.144 * 3, "projection at recent pace");
  assert.match(b.burn.projection.label, /PROJECTION/);
  const text = B.formatBlocks(r); assert.match(text, /ACTIVE/); assert.match(text, /PROJECTION to the block end/); assert.match(text, /not a measurement|guess about the future/); assert.match(text, /list-price equivalent/); assert.match(text, /last 30 minutes/);
  // fewer than 5 messages in the last 30 minutes: that rate is not shown (honest), the block-so-far rate still is
  const early = await B.blocksReport({ dir, days: 7, now: A + H + 50 * MIN }); const e = early.blocks[0];
  assert.equal(e.burn.last30MinPerHour, null); assert.ok(e.burn.perHourSoFar > 0); assert.equal(e.burn.projection.atRecentPace, null);
  assert.match(B.formatBlocks(early), /needs at least 5 messages/);
  // too little activity for any rate
  const tiny = await B.blocksReport({ dir, days: 7, now: A + 35 * MIN }); assert.equal(tiny.blocks[0].burn.perHourSoFar, null); assert.match(B.formatBlocks(tiny), /too early to say/);
});

await t("FEAT-REPORT-4", "blocks: an empty folder gives a plain message, and a bad --days is refused", async () => {
  const home = sandbox(), B = await imp("scripts/blocks.mjs"); const dir = path.join(home, ".claude", "projects"); fs.mkdirSync(dir, { recursive: true });
  const r = run("scripts/blocks.mjs", ["--projects-dir", dir], home); assert.equal(r.status, 0); assert.match(r.stdout, /No Claude messages found in the last 7 days/); assert.match(r.stdout, /MEASURED/);
  assert.match(B.formatBlocks(await B.blocksReport({ dir: path.join(home, "missing"), days: 3 })), /No Claude messages found in the last 3 days/);
  const bad = run("scripts/blocks.mjs", ["--days", "7x"], home); assert.equal(bad.status, 2); assert.match(bad.stderr, /--days needs a plain number/);
  const viaMain = run("scripts/usage-max.mjs", ["blocks", "--projects-dir", dir], home); assert.equal(viaMain.status, 0); assert.match(viaMain.stdout, /usage-max blocks/, "reachable as a usage-max subcommand");
});

await t("FEAT-REPORT-5", "blocks: a model missing from the price table is marked, never free", async () => {
  const home = sandbox(), B = await imp("scripts/blocks.mjs");
  const dir = writeProj(home, "p1", { "s.jsonl": rec("u1", "claude-mystery-9", A + 10 * MIN, plain()) });
  const r = await B.blocksReport({ dir, days: 7, now: A + 8 * H }); assert.deepEqual(r.blocks[0].unknownModels, ["claude-mystery-9"]); close(r.blocks[0].cost, 0.03, "priced like the opus family, not zero");
  assert.match(B.formatBlocks(r), /claude-mystery-9: not in the price table.*ESTIMATE/);
});

const turn = (t, model, u, extra = {}) => ({ t: 1e12 + t, model, u, oneHour: false, boundaryBefore: false, ...extra });
const U = async (read, created, extra = {}) => (await imp("scripts/lib.mjs")).normalizeUsage({ input_tokens: 1, output_tokens: 100, cache_read_input_tokens: read, cache_creation_input_tokens: created, ...extra });

await t("FEAT-REPORT-6", "cache breaks: each cause is classified, counted and priced exactly (list price, estimate)", async () => {
  const C = await imp("scripts/cachebreak.mjs"); let ts = 0; const at = (m) => { ts += m * MIN; return ts; };
  const turns = [
    turn(at(0), SONNET, await U(0, 50000)),
    turn(at(1), SONNET, await U(50000, 2000)),
    turn(at(10), SONNET, await U(0, 52000)), // idle: 10 minutes > 5
    turn(at(1), SONNET, await U(52000, 1000)),
    turn(at(1), OPUS, await U(0, 53000)), // model switch
    turn(at(1), OPUS, await U(53000, 500)),
    turn(at(1), OPUS, await U(0, 30000), { boundaryBefore: true }), // compaction record in between
    turn(at(1), OPUS, await U(30000, 500)),
    turn(at(1), OPUS, await U(0, 30500)), // nothing explains it
    turn(at(1), OPUS, await U(30500, 100)),
    turn(at(1), OPUS, await U(30600, 100)) // cache stays high: no break
  ];
  const r = C.detectCacheBreaks(turns);
  assert.equal(r.count, 4); assert.deepEqual(r.breaks.map((b) => b.cause), ["idle", "model", "compaction", "unexplained"]);
  close(r.breaks[0].extraCost, (52000 * (4 - 0.1)) / 1e6, "idle: sonnet re-wrote 52k at $4 instead of reading at $0.1");
  close(r.breaks[1].extraCost, (53000 * (8 - 0.2)) / 1e6, "model switch: opus 5.5 rates");
  close(r.breaks[2].extraCost, (30000 * 7.8) / 1e6, "compaction"); close(r.breaks[3].extraCost, (30500 * 7.8) / 1e6, "unexplained");
  close(r.extraCost, 0.2028 + 0.4134 + 0.234 + 0.2379, "total"); assert.deepEqual(r.top.map((b) => b.cause), ["model", "unexplained", "compaction"], "top 3 by extra cost");
  assert.deepEqual(Object.keys(r.byCause).sort(), ["compaction", "idle", "model", "unexplained"]); assert.equal(r.byCause.idle.count, 1);
  const text = C.formatCacheBreaks(r).join("\n");
  for (const re of [/ESTIMATE at list price/, /INFERRED/, /4, about \$1\.09 extra/, /idle longer than the cache lifetime/, /model switch/, /compaction/, /unexplained \(something changed the start of the conversation: edited CLAUDE\.md, changed tools\/MCP servers, or changed settings\)/, /send a short message before the 5-minute mark or accept the one-time cost/, /avoid editing CLAUDE\.md or switching tools\/models mid-session/, /avoid changing models mid-session/]) assert.match(text, re);
  // compaction without a boundary record: the context shrank to under half
  const drop = C.detectCacheBreaks([turn(0, SONNET, await U(100000, 1000)), turn(MIN, SONNET, await U(0, 25000))]);
  assert.equal(drop.count, 1); assert.equal(drop.breaks[0].cause, "compaction"); close(drop.breaks[0].extraCost, (25000 * 3.9) / 1e6, "drop");
});

await t("FEAT-REPORT-7", "cache breaks: the 1-hour cache lifetime and the 5m/1h write rates are honoured", async () => {
  const C = await imp("scripts/cachebreak.mjs");
  const oneH = await U(0, 50000, { cache_creation: { ephemeral_1h_input_tokens: 50000, ephemeral_5m_input_tokens: 0 } });
  const read = await U(50000, 100);
  // 10 minutes of silence is fine when the transcript shows 1-hour writes: the cache was still alive, so this break is not "idle"
  const a = C.detectCacheBreaks([turn(0, SONNET, oneH, { oneHour: true }), turn(MIN, SONNET, read), turn(11 * MIN, SONNET, await U(0, 50100))]);
  assert.equal(a.count, 1); assert.equal(a.breaks[0].cause, "unexplained"); assert.equal(a.breaks[0].ttlMs, 60 * MIN);
  // 61 minutes is idle even then, and the advice names the 1-hour mark
  const b = C.detectCacheBreaks([turn(0, SONNET, oneH, { oneHour: true }), turn(MIN, SONNET, read), turn(62 * MIN, SONNET, await U(0, 50100))]);
  assert.equal(b.breaks[0].cause, "idle"); assert.match(C.formatCacheBreaks(b).join("\n"), /before the 1-hour mark/);
  // a 5-minute write is priced at the 5-minute rate ($2.5/M for sonnet 5.5), not the 1-hour rate
  const w5 = await U(0, 52000, { cache_creation: { ephemeral_5m_input_tokens: 52000, ephemeral_1h_input_tokens: 0 } });
  const c = C.detectCacheBreaks([turn(0, SONNET, await U(50000, 2000)), turn(10 * MIN, SONNET, w5)]);
  assert.equal(c.breaks[0].cause, "idle"); close(c.breaks[0].extraCost, (52000 * (2.5 - 0.1)) / 1e6, "5m rate");
});

await t("FEAT-REPORT-8", "cache breaks: no break when the cache read stays high, when the re-write is small, or when there was nothing cached before", async () => {
  const C = await imp("scripts/cachebreak.mjs");
  const calm = [turn(0, SONNET, await U(0, 60000)), turn(MIN, SONNET, await U(60000, 25000)), turn(2 * MIN, SONNET, await U(85000, 22000)), turn(3 * MIN, SONNET, await U(30000, 21000))]; // reads stay >= 30k although a lot is also written
  const r = C.detectCacheBreaks(calm); assert.equal(r.count, 0); assert.match(C.formatCacheBreaks(r).join("\n"), /cache breaks: none found/);
  assert.equal(C.detectCacheBreaks([turn(0, SONNET, await U(50000, 100)), turn(20 * MIN, SONNET, await U(0, 5000))]).count, 0, "re-write under 20k tokens is not reported");
  assert.equal(C.detectCacheBreaks([turn(0, SONNET, await U(5000, 100)), turn(20 * MIN, SONNET, await U(0, 60000))]).count, 0, "previous read under 20k tokens: a fresh start, not a break");
  assert.equal(C.detectCacheBreaks([]).count, 0);
});

const chain = (ids, base) => { // an idle break between the 2nd and 3rd turn; ids make the messages dedupable
  const u = (r, c) => ({ input_tokens: 1, output_tokens: 100, cache_read_input_tokens: r, cache_creation_input_tokens: c });
  return [rec(ids[0], SONNET, base, u(0, 50000)), rec(ids[1], SONNET, base + MIN, u(50000, 2000)), rec(ids[2], SONNET, base + 12 * MIN, u(0, 52000)), rec(ids[3], SONNET, base + 13 * MIN, u(52000, 100))];
};

await t("FEAT-REPORT-9", "diagnose: reports the cache break from a real transcript; copies of the same messages are not counted twice", async () => {
  const home = sandbox(); const base = Date.now() - 3 * H; const lines = chain(["a", "b", "c", "d"], base);
  const dir = writeProj(home, "p1", { "main.jsonl": lines.join("") + lines[2], "zz-resumed.jsonl": lines.join("") }); // a repeated content-block record + a full copy in a resumed session
  const j = JSON.parse(run("scripts/diagnose.mjs", ["--projects-dir", dir, "--days", "1", "--json"], home).stdout);
  assert.equal(j.turns, 4, "four distinct messages"); assert.equal(j.cacheBreaks.count, 1, "one break, not one per copy"); assert.equal(j.cacheBreaks.breaks[0].cause, "idle");
  close(j.cacheBreaks.extraCost, (52000 * 3.9) / 1e6, "extra cost");
  const out = run("scripts/diagnose.mjs", ["--projects-dir", dir, "--days", "1"], home).stdout;
  assert.match(out, /cache breaks \(MEASURED token pattern; the cause is INFERRED.*ESTIMATE at list price\): 1, about \$0\.20 extra/); assert.match(out, /1 x idle longer than the cache lifetime/); assert.match(out, /send a short message before the 5-minute mark/);
  // a compaction record between the turns turns the same pattern into a compaction
  const lines2 = chain(["a", "b", "c", "d"], base); lines2.splice(2, 0, JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: new Date(base + 2 * MIN).toISOString() }) + "\n");
  lines2[3] = rec("c", SONNET, base + 3 * MIN, { input_tokens: 1, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 52000 }); // 2 minutes after the previous turn: not idle
  const dir2 = writeProj(sandbox(), "p2", { "main.jsonl": lines2.join("") });
  const j2 = JSON.parse(run("scripts/diagnose.mjs", ["--projects-dir", dir2, "--days", "1", "--json"], home).stdout); assert.equal(j2.cacheBreaks.count, 1); assert.equal(j2.cacheBreaks.breaks[0].cause, "compaction");
  // no break at all
  const calm = writeProj(sandbox(), "p3", { "main.jsonl": [rec("a", SONNET, base, plain()), rec("b", SONNET, base + MIN, plain())].join("") });
  assert.match(run("scripts/diagnose.mjs", ["--projects-dir", calm, "--days", "1"], home).stdout, /cache breaks: none found/);
});

await t("FEAT-REPORT-10", "savings: recent pace line and a basis on every figure", async () => {
  const home = sandbox(), S = await imp("scripts/savings.mjs"); const now = Date.now() + 1000;
  const dir = writeProj(home, "p1", { "s.jsonl": [rec("n1", SONNET, now - H, plain()), rec("n2", SONNET, now - 2 * H, plain()), rec("o1", SONNET, now - 3 * 864e5, plain()), rec("o2", SONNET, now - 4 * 864e5, plain()), rec("o3", SONNET, now - 5 * 864e5, plain())].join("") });
  const r = await S.claudeSavings({ dir, days: 7, now });
  close(r.pace.cost24h, 0.024, "last 24h"); close(r.pace.cost7d, 0.06, "last 7d"); close(r.pace.perHour24h, 0.001, "per hour 24h"); close(r.pace.perHour7d, 0.06 / 168, "per hour 7d");
  const text = S.formatClaude(r); assert.match(text, /measured\s+recent pace: last 24 hours \$0\.00\/hour list-price vs \$0\.00\/hour averaged over 7 days \(2\.8x; calendar hours, idle hours included; only 5\.0 days of history found/);
  const short = await S.claudeSavings({ dir, days: 1, now }); assert.equal(short.turns, 2, "the 1-day window itself is unchanged"); close(short.pace.cost7d, 0.06, "pace still looks at 7 days");
  for (const line of text.split("\n").slice(1)) { if (!/\$/.test(line)) continue; assert.match(line, /^(measured|estimate|what-if)\s|^\s+more:/, "tagged: " + line); if (/^measured/.test(line)) assert.match(line, /list-price/, "dollars say list-price: " + line); }
  assert.match(text, /basis: measured = counted from your transcripts; list-price = /);
  const odd = await S.claudeSavings({ dir: writeProj(sandbox(), "p9", { "s.jsonl": rec("x", "claude-mystery-9", now - H, plain()) }), days: 1, now }); assert.deepEqual(odd.unknownModels, ["claude-mystery-9"]); assert.match(S.formatClaude(odd), /estimate\s+claude-mystery-9 not in the price table/);
});

await t("FEAT-REPORT-11", "plugin-diet: only checks provable from files on disk (long instruction files, long plugin and MCP lists)", async () => {
  const home = sandbox(), D = await imp("scripts/plugin-diet.mjs"); const cwd = path.join(home, "proj"); fs.mkdirSync(cwd, { recursive: true });
  const many = (n) => Array.from({ length: n }, (_, i) => "line " + i).join("\n");
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), many(250)); fs.writeFileSync(path.join(cwd, "AGENTS.md"), many(210));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true }); fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p${i}@m`, true])) }));
  fs.writeFileSync(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 6 }, (_, i) => ["s" + i, { command: "x" }])) }));
  const why = (r, id) => (r.advice.find((a) => a.id === id) || {}).why || "";
  const r = D.diet({ home, cwd, days: 30 });
  assert.match(why(r, path.join(cwd, "CLAUDE.md")), /250 lines, over the ~200-line guideline/); assert.match(why(r, path.join(cwd, "AGENTS.md")), /AGENTS\.md is 210 lines/);
  assert.match(why(r, "enabled plugins"), /^10 plugins are switched on in settings\.json/); assert.match(why(r, "MCP servers"), /^6 MCP servers are configured/);
  assert.equal(r.alwaysLoadedTokens, r.rows.reduce((a, x) => a + (x.tokens || 0), 0), "AGENTS.md is not added to the always-loaded total");
  // short files and short lists: none of these four
  const home2 = sandbox(), cwd2 = path.join(home2, "proj"); fs.mkdirSync(cwd2, { recursive: true }); fs.writeFileSync(path.join(cwd2, "CLAUDE.md"), many(50)); fs.writeFileSync(path.join(cwd2, "AGENTS.md"), many(50));
  fs.mkdirSync(path.join(home2, ".claude"), { recursive: true }); fs.writeFileSync(path.join(home2, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "a@m": true, "b@m": true } }));
  const q = D.diet({ home: home2, cwd: cwd2, days: 30 }); assert.equal(q.advice.filter((a) => a.action === "review" || a.action === "trim").length, 0, JSON.stringify(q.advice));
});

console.log(`${n} passing`);
