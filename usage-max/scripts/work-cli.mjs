// `usage-max work ...`: CLI over the durable work queue in scripts/governance (enqueue, list, show, verify, recover).
// The FIFO `queue` verb (guard.mjs) is a different thing and is untouched. Library calls only; nothing is reimplemented here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dataDir } from "./meter.mjs";

const GOV = path.join(path.dirname(fileURLToPath(import.meta.url)), "governance");
const G = (f) => import(pathToFileURL(path.join(GOV, f)).href);

export const USAGE = `usage: usage-max work <sub> [--root <dir>] [--json]
  enqueue <task.json>            add a work unit; prints {workId, state}
  list [--json]                  one line per unit: workId, state, attempt, updated (INVALID = record fails verification)
  show <workId>                  the verified record as JSON
  verify <workId> <attemptId>    check the admission/outcome receipts; exit 0 pass, 1 fail
  recover [--json]               move units whose lease has expired to 'retryable'; exit 1 if any unit failed (others still processed)
  --root <dir>                   default <data dir>/work (~/.claude/usage-max/work); avoid OneDrive folders
  admit/checkpoint/complete/retry need a route registry and executors: programmatic API in scripts/governance
  task.json example: {"workId":"W-1","mode":"interactive","task":{"id":"W-1","qualityThreshold":0.85,"requiredCapabilities":["extract"]}}
  exit codes: 0 ok, 1 governance/verification failure or not found, 2 usage or input error (bad args, unreadable or incomplete task JSON)
  (task.id must equal workId; workId is 1-128 chars of A-Za-z0-9._- starting with a letter or digit)`;

class UsageError extends Error {}

function parse(args) {
  const o = { json: false, root: null, pos: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") o.json = true;
    else if (a === "--root") { o.root = args[++i]; if (!o.root || o.root.startsWith("--")) throw new UsageError("--root needs a directory"); }
    else if (a.startsWith("--")) throw new UsageError(`unknown option ${a}`);
    else o.pos.push(a);
  }
  return o;
}

const queueDir = (root) => path.join(root, "operations", "runs", "usage-max", "queue");
const need = (o, n) => { if (o.pos.length !== n) throw new UsageError(`expected ${n} argument(s), got ${o.pos.length}`); };

async function units(root) { // [{workId, file, record?, error?}] for every <workId>.json in the queue directory
  const { readQueuedWorkUnit, verifyQueueRecord } = await G("durable-queue.mjs");
  let names = [];
  try { names = fs.readdirSync(queueDir(root)).filter((n) => n.endsWith(".json")).sort(); } catch {}
  return names.map((n) => {
    const workId = n.slice(0, -5), file = path.join(queueDir(root), n);
    try { verifyQueueRecord({ root, workId }); return { workId, file, record: readQueuedWorkUnit({ root, workId }) }; }
    catch (e) { return { workId, file, error: e.message }; }
  });
}

export async function main(args) {
  const [sub, ...rest] = args;
  if (sub === "help" || sub === "--help") { console.log(USAGE); return 0; }
  try {
    if (!["enqueue", "list", "show", "verify", "recover"].includes(sub)) throw new UsageError(sub ? `unknown work subcommand "${sub}"` : "missing work subcommand");
    const o = parse(rest);
    const root = path.resolve(o.root || path.join(dataDir(), "work"));
    if (/onedrive/i.test(root)) console.error(`warning: ${root} is under OneDrive; file renames can fail while it syncs. Use --root <dir> outside OneDrive.`);
    const rootExists = fs.existsSync(root);
    const { assertSafeIdentifier } = await G("identifiers.mjs");
    if (sub === "enqueue") {
      need(o, 1);
      let request; try { request = JSON.parse(fs.readFileSync(o.pos[0], "utf8")); } catch (e) { throw new UsageError(`cannot read task JSON ${o.pos[0]}: ${e.message}`); }
      assertSafeIdentifier(request?.workId, "request.workId");
      if (typeof request.task?.id !== "string") throw new UsageError(`task JSON ${o.pos[0]} is missing required field task.id`);
      fs.mkdirSync(root, { recursive: true });
      const { enqueueWorkUnit } = await G("durable-queue.mjs");
      const { record } = enqueueWorkUnit({ root, request });
      console.log(JSON.stringify({ workId: record.workId, state: record.state }));
    } else if (sub === "list") {
      need(o, 0);
      const rows = (await units(root)).map((u) => u.record
        ? { workId: u.workId, state: u.record.state, attempt: u.record.attempts.length, updated: fs.statSync(u.file).mtime.toISOString() }
        : { workId: u.workId, state: "INVALID", attempt: null, updated: fs.statSync(u.file).mtime.toISOString(), error: u.error });
      if (o.json) console.log(JSON.stringify(rows, null, 2));
      else console.log(rows.length ? rows.map((r) => `${r.workId}  ${r.state}  attempt ${r.attempt ?? "-"}  ${r.updated}${r.error ? `  (${r.error})` : ""}`).join("\n") : "no work units.");
    } else if (sub === "show") {
      need(o, 1); assertSafeIdentifier(o.pos[0], "workId");
      const { readQueuedWorkUnit, verifyQueueRecord } = await G("durable-queue.mjs");
      if (!fs.existsSync(path.join(queueDir(root), `${o.pos[0]}.json`))) { console.error(`not found: work unit ${o.pos[0]} (root ${root})`); return 1; }
      verifyQueueRecord({ root, workId: o.pos[0] });
      console.log(JSON.stringify(readQueuedWorkUnit({ root, workId: o.pos[0] }), null, 2));
    } else if (sub === "verify") {
      need(o, 2); assertSafeIdentifier(o.pos[0], "workId"); assertSafeIdentifier(o.pos[1], "attemptId");
      const { verifyUsageReceipts } = await G("verify-receipts.mjs");
      if (!rootExists) { console.log(JSON.stringify({ pass: false, workId: o.pos[0], attemptId: o.pos[1], error: `not found: root ${root} does not exist` })); return 1; }
      try { console.log(JSON.stringify(verifyUsageReceipts(root, o.pos[0], o.pos[1]))); }
      catch (e) { console.log(JSON.stringify({ pass: false, workId: o.pos[0], attemptId: o.pos[1], error: e.message })); return 1; }
    } else {
      need(o, 0);
      const { recoverAbandonedWorkUnit } = await G("durable-queue.mjs");
      const recovered = [], skipped = [], failed = [];
      for (const u of await units(root)) {
        if (u.error) { skipped.push({ workId: u.workId, error: u.error }); continue; }
        if (!u.record.activeAttempt) continue;
        try {
          const r = recoverAbandonedWorkUnit({ root, workId: u.workId }); // the governance function decides: lease expiresAt <= now
          if (r.recovered) recovered.push({ workId: u.workId, state: r.queue.state });
        } catch (e) { failed.push({ workId: u.workId, error: e.message }); }
      }
      for (const s of skipped) console.error(`skipped INVALID ${s.workId}: ${s.error}`);
      for (const f of failed) console.error(`failed ${f.workId}: ${f.error}`);
      if (o.json) console.log(JSON.stringify({ recovered, failed, skipped }, null, 2));
      else {
        if (recovered.length) console.log(recovered.map((r) => `recovered ${r.workId} -> ${r.state}`).join("\n"));
        if (failed.length) console.log(failed.map((f) => `failed ${f.workId}: ${f.error}`).join("\n"));
        if (!recovered.length && !failed.length) console.log("nothing to recover.");
      }
      if (failed.length) return 1;
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${USAGE}`); return 2; }
    if (e instanceof TypeError && /(workId|attemptId|identifier)\b.*(1-128|unsafe)/.test(e.message)) { console.error(e.message); return 2; }
    console.error(e.message); return 1;
  }
}
