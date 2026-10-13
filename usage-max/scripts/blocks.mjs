#!/usr/bin/env node
// `usage-max blocks`: your Claude usage grouped into 5-hour blocks, the way the ccusage tool does it. Read-only, local transcripts only, no model calls, no network.
// Basis of every number: tokens and message counts are MEASURED from your transcripts; dollars are a LIST-PRICE equivalent (a yardstick, not a bill: you are on a subscription);
// anything about the end of the active block is a PROJECTION that assumes the current pace continues.
//
// Block rule: a block starts at its first message's time rounded down to the whole hour (UTC hour, so it is the same in every time zone) and lasts 5 hours, end excluded.
// A message at or after the block end, or more than 5 hours after the previous message, starts a new block. Times are shown in your local time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listJsonlFiles, normalizeUsage, parseTimestamp, createDeduper, parseDays, DAYS_MESSAGE } from "./lib.mjs";
import { priceFor, turnCost } from "./pricing.mjs";

export const HOUR_MS = 36e5;
export const BLOCK_MS = 5 * HOUR_MS;
const RECENT_MS = 30 * 60000;
const RECENT_MIN_MESSAGES = 5;
const MIN_RATE_MS = 10 * 60000; // under 10 minutes of activity a "per hour" rate would be mostly noise

// Pure. msgs: [{ t, model, u (normalizeUsage output), cost, unknown }]. Returns blocks oldest first.
export function buildBlocks(msgs, { now = Date.now() } = {}) {
  const sorted = [...msgs].filter((m) => m && m.t > 0).sort((a, b) => a.t - b.t);
  const blocks = []; let cur = null, last = 0;
  for (const m of sorted) {
    if (!cur || m.t >= cur.end || m.t - last > BLOCK_MS) {
      const start = Math.floor(m.t / HOUR_MS) * HOUR_MS;
      cur = { start, end: start + BLOCK_MS, firstT: m.t, lastT: m.t, messages: 0, input: 0, output: 0, cacheCreation: 0, cacheRead: 0, cost: 0, models: {}, unknownModels: [], times: [] };
      blocks.push(cur);
    }
    cur.messages++; cur.lastT = m.t; last = m.t; cur.times.push({ t: m.t, cost: m.cost });
    cur.input += m.u.input; cur.output += m.u.output; cur.cacheCreation += m.u.created; cur.cacheRead += m.u.read; cur.cost += m.cost;
    cur.models[m.model] = (cur.models[m.model] || 0) + 1;
    if (m.unknown && !cur.unknownModels.includes(m.model)) cur.unknownModels.push(m.model);
  }
  for (const b of blocks) {
    b.active = now >= b.start && now < b.end;
    if (b.active) b.burn = burnFor(b, now);
    delete b.times;
  }
  return blocks;
}

function burnFor(b, now) {
  const elapsedMs = now - b.firstT, remainingH = Math.max(b.end - now, 0) / HOUR_MS;
  const perHour = elapsedMs >= MIN_RATE_MS ? b.cost / (elapsedMs / HOUR_MS) : null;
  const recent = b.times.filter((x) => x.t > now - RECENT_MS && x.t <= now);
  const last30 = recent.length >= RECENT_MIN_MESSAGES ? recent.reduce((a, x) => a + x.cost, 0) / (RECENT_MS / HOUR_MS) : null;
  return {
    basis: "list-price equivalent, per hour",
    perHourSoFar: perHour, last30MinPerHour: last30, last30MinMessages: recent.length, hoursLeft: remainingH,
    projection: {
      label: "PROJECTION (assumes the pace continues; not a measurement)",
      atBlockPace: perHour === null ? null : b.cost + perHour * remainingH,
      atRecentPace: last30 === null ? null : b.cost + last30 * remainingH
    }
  };
}

export async function collectMessages({ dir, days = 7, now = Date.now() } = {}) {
  const lo = now - days * 864e5, dedupe = createDeduper(); let skippedNoTime = 0;
  for (const file of await listJsonlFiles(dir)) {
    let text; try { if (fs.statSync(file).mtimeMs < lo) continue; text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue; let r; try { r = JSON.parse(line); } catch { continue; }
      const m = r && r.message; if (r.type !== "assistant" || !m || !m.model || m.model === "<synthetic>") continue;
      dedupe.add(m, { m, t: parseTimestamp(r.timestamp) }); // one message repeated across files counts once, at its largest output
    }
  }
  const msgs = [];
  for (const { m, t } of dedupe.items()) {
    if (!t) { skippedNoTime++; continue; }
    if (t < lo || t > now) continue;
    const u = normalizeUsage(m.usage), p = priceFor(m.model, u.input + u.created + u.read);
    msgs.push({ t, model: m.model, u, cost: turnCost(u, p).total, unknown: !p || p.fallback === true });
  }
  return { msgs, skippedNoTime };
}

export async function blocksReport({ dir, days = 7, now = Date.now() } = {}) {
  const { msgs, skippedNoTime } = await collectMessages({ dir, days, now });
  const blocks = buildBlocks(msgs, { now });
  return {
    window: { days, from: new Date(now - days * 864e5).toISOString(), to: new Date(now).toISOString() },
    basis: { tokens: "measured from your transcripts", cost: "list-price equivalent (a yardstick, not a bill)", projection: "projection, assumes the current pace continues" },
    messages: msgs.length, skippedNoTime, blocks: blocks.map((b) => ({ ...b, startIso: new Date(b.start).toISOString(), endIso: new Date(b.end).toISOString(), models: Object.keys(b.models).sort((x, y) => b.models[y] - b.models[x]), modelMessages: b.models })), dir
  };
}

const pad2 = (n) => String(n).padStart(2, "0");
export const localTime = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (x) => `$${x.toFixed(x >= 100 ? 0 : 2)}`;

export function formatBlocks(r) {
  const o = [];
  o.push(`usage-max blocks - last ${r.window.days} days, 5-hour usage blocks (read-only, from your local transcripts)`);
  o.push("Basis: tokens and message counts are MEASURED from your transcripts. Dollars are a LIST-PRICE equivalent (a yardstick for comparing blocks, not a bill: you are on a subscription).");
  if (!r.blocks.length) {
    o.push(`No Claude messages found in the last ${r.window.days} days under ${r.dir}. Cloud sessions start empty; run this on the computer where you work, or try a larger --days.`);
    return o.join("\n");
  }
  const rows = r.blocks.map((b) => [localTime(b.start), localTime(b.end), String(b.messages), tok(b.input), tok(b.output), tok(b.cacheCreation), tok(b.cacheRead), usd(b.cost) + (b.unknownModels.length ? "*" : ""), b.active ? "ACTIVE" : "", b.models.join(", ") + (b.unknownModels.length ? ` (* ${b.unknownModels.join(", ")}: not in the price table, priced like the nearest model family: ESTIMATE)` : "")]);
  const head = ["Start", "End", "Msgs", "Input", "Output", "CacheWrite", "CacheRead", "List-price", "", "Models"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((x) => x[i].length)));
  const fmt = (x) => x.map((c, i) => (i === 0 || i === 1 || i >= 8 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ").trimEnd();
  o.push(fmt(head)); for (const x of rows) o.push(fmt(x));
  const tot = r.blocks.reduce((a, b) => a + b.cost, 0);
  o.push(`${r.blocks.length} block(s), ${r.messages} messages, ${usd(tot)} list-price equivalent in total.`);
  if (r.skippedNoTime) o.push(`(${r.skippedNoTime} message(s) had no timestamp and could not be placed in a block.)`);
  const a = r.blocks.find((b) => b.active);
  if (a) {
    const bn = a.burn, left = bn.hoursLeft;
    o.push("");
    o.push(`ACTIVE block: ${localTime(a.start)} to ${localTime(a.end)} (${Math.floor(left)}h ${Math.round((left % 1) * 60)}m left), ${a.messages} messages, ${usd(a.cost)} list-price equivalent so far (measured tokens).`);
    o.push(bn.perHourSoFar === null ? "  burn rate: too early to say (under 10 minutes of activity in this block)." : `  burn rate over the block so far: ${usd(bn.perHourSoFar)}/hour list-price equivalent (${usd(a.cost)} over the time since its first message).`);
    o.push(bn.last30MinPerHour === null ? `  burn rate over the last 30 minutes: not shown (needs at least ${RECENT_MIN_MESSAGES} messages in that time; there ${bn.last30MinMessages === 1 ? "was" : "were"} ${bn.last30MinMessages}).` : `  burn rate over the last 30 minutes: ${usd(bn.last30MinPerHour)}/hour list-price equivalent (${bn.last30MinMessages} messages).`);
    const p = bn.projection;
    if (p.atBlockPace !== null) o.push(`  PROJECTION to the block end: about ${usd(p.atBlockPace)} if the block-so-far pace continues${p.atRecentPace !== null ? `, about ${usd(p.atRecentPace)} if the last-30-minutes pace continues` : ""}. A projection is a guess about the future, not a measurement.`);
    else o.push("  PROJECTION to the block end: not shown yet (too early for a reliable rate).");
  } else o.push("No block is active right now (your last message was more than 5 hours ago or the last block has ended).");
  return o.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const flag = (n) => { const i = a.indexOf(`--${n}`); return i === -1 ? undefined : a[i + 1]; };
  const home = process.env.USAGE_MAX_HOME || os.homedir();
  const days = a.includes("--days") && flag("days") === undefined ? null : parseDays(flag("days"), 7);
  if (days === null) { console.error(DAYS_MESSAGE); process.exit(2); }
  const r = await blocksReport({ dir: flag("projects-dir") || path.join(home, ".claude", "projects"), days });
  console.log(a.includes("--json") ? JSON.stringify(r, null, 2) : formatBlocks(r));
}
