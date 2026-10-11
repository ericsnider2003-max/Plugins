#!/usr/bin/env node
// Claude-side savings report, the counterpart of codex/scripts/savings.mjs. Local transcripts only, read-only, no model calls.
// Every line is tagged: measured (from transcripts), estimate (a counterfactual, stated as such) or what-if (a lever you could pull, NOT a saving).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { listJsonlFiles, normalizeUsage, parseTimestamp } from "./lib.mjs";
import { priceFor, turnCost } from "./pricing.mjs";

const SONNET = "claude-sonnet-5-5";
const usd = (x) => `$${x.toFixed(x >= 100 ? 0 : 2)}`;

export async function claudeSavings({ dir, days = 7, now = Date.now() } = {}) {
  const lo = now - days * 864e5; const byModel = {}; const hub = {}; let subCost = 0, hubCost = 0, turns = 0, subTurns = 0; const subTurnList = [];
  for (const file of await listJsonlFiles(dir)) {
    const isSub = file.includes(`${path.sep}subagents${path.sep}`) || file.includes("/subagents/"); const seen = new Set(); let text; try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue; let r; try { r = JSON.parse(line); } catch { continue; }
      const m = r && r.message; if (r.type !== "assistant" || !m || !m.model || m.model === "<synthetic>") continue;
      if (m.id) { if (seen.has(m.id)) continue; seen.add(m.id); }
      const t = parseTimestamp(r.timestamp); if (t && (t < lo || t > now)) continue;
      const u = normalizeUsage(m.usage); const ctx = u.input + u.created + u.read; const p = priceFor(m.model, ctx); if (!p) continue;
      const c = turnCost(u, p).total; const side = isSub || r.isSidechain === true;
      const b = (byModel[m.model] = byModel[m.model] || { turns: 0, cost: 0, sub: 0 }); b.turns++; b.cost += c; turns++;
      if (side) { subCost += c; subTurns++; b.sub += c; subTurnList.push({ u, ctx }); } else { hubCost += c; hub[m.model] = (hub[m.model] || 0) + c; }
    }
  }
  const total = hubCost + subCost; const hubModel = Object.entries(hub).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  let counterfactual = null;
  if (hubModel && subTurns) { let c = 0; for (const s of subTurnList) { const p = priceFor(hubModel, s.ctx); if (p) c += turnCost(s.u, p).total; } counterfactual = { hubModel, ifOnHub: c, saved: Math.max(0, c - subCost) }; }
  const whatIfSonnet = hubModel && !/sonnet|haiku/.test(hubModel) ? { model: SONNET, pricePerMTokOutput: priceFor(SONNET).output, hubOutputPrice: priceFor(hubModel).output } : null;
  return { window: { days, from: new Date(lo).toISOString(), to: new Date(now).toISOString() }, turns, subTurns, total, hubCost, subCost, hubModel, byModel, counterfactual, whatIfSonnet };
}

export function formatClaude(r) {
  const o = []; const M = (s) => o.push(`measured  ${s}`), E = (s) => o.push(`estimate  ${s}`), W = (s) => o.push(`what-if   ${s}`);
  o.push(`CLAUDE (${r.window.days} days, local transcripts, list-price proxy for plan use; read-only)`);
  if (!r.turns) { o.push("  no Claude transcripts in this window (cloud sessions start empty; run this on the PC where you work)."); return o.join("\n"); }
  M(`${r.turns} turns, ${usd(r.total)} at list price; main loop ${usd(r.hubCost)}, subagents ${usd(r.subCost)} (${r.subTurns} turns, ${Math.round(100 * r.subCost / (r.total || 1))}% of spend)`);
  for (const [k, v] of Object.entries(r.byModel).sort((a, b) => b[1].cost - a[1].cost)) M(`${k}: ${v.turns} turns, ${usd(v.cost)} (${Math.round(100 * v.cost / (r.total || 1))}%)`);
  if (r.counterfactual) E(`delegation: the subagent work cost ${usd(r.subCost)}; the same tokens on the main model (${r.counterfactual.hubModel}) would have cost ~${usd(r.counterfactual.ifOnHub)}, so ~${usd(r.counterfactual.saved)} saved (assumes the main model would have used the same tokens; real savings depend on that)`);
  else E("delegation: no subagent turns in this window, so routing has saved nothing measurable yet");
  if (r.whatIfSonnet) W(`main model is ${r.hubModel} (output $${r.whatIfSonnet.hubOutputPrice}/M vs Sonnet $${r.whatIfSonnet.pricePerMTokOutput}/M): main-loop spend is ${usd(r.hubCost)}; moving routine turns to Sonnet is the biggest lever left (not a saving until you do it)`);
  try { const c = (JSON.parse(fs.readFileSync(path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "usage-max", "events.json"), "utf8")).counts) || {}; if (c.offloadJobs) E(`local model: ${c.offloadJobs} jobs run on your own machine, ~${Math.round((c.offloadInputChars || 0) / 4).toLocaleString("en-US")} input tokens that never touched your plan (chars/4; the plan would also have paid for the output and for re-reading it)`); } catch {}
  const share = r.subCost / (r.total || 1);
  o.push(share < 0.25 ? "  more: only " + Math.round(100 * share) + "% of spend is delegated. Send reading/searching/web/formatting to usage-max-scout and edits/tests to usage-max-worker; compare again next week." : "  more: delegation is already a healthy share; remaining levers are context size (`usage-max context`, `usage-max diet`) and cold-cache gaps (`usage-max diagnose`).");
  return o.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("savings.mjs")) {
  const a = process.argv.slice(2); const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i === -1 ? d : a[i + 1]; };
  const home = process.env.USAGE_MAX_HOME || os.homedir(); const r = await claudeSavings({ dir: flag("projects-dir", path.join(home, ".claude", "projects")), days: Number(flag("days", 7)) || 7 });
  console.log(a.includes("--json") ? JSON.stringify(r, null, 2) : formatClaude(r));
}
