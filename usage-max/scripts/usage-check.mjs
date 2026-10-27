#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeProjects, modelFamily, weeklyStart, resolveResetSpec, ceilingStatus, formatNumber, pace, roundDecimal, fixedDecimal } from "./lib.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

function homeDir() {
  return process.env.USAGE_MAX_HOME || os.homedir();
}

function writeStatus(file, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(status, null, 2)}\n`);
}

async function main() {
  const now = new Date();
  // Real plan numbers, when the status line has captured them (rate_limits from Claude Code).
  let limits = null;
  try {
    const l = JSON.parse(fs.readFileSync(arg("limits", path.join(homeDir(), ".claude", "usage-max", "limits.json")), "utf8"));
    const usable = Object.values(l).filter((x) => x && typeof x === "object" && Number.isFinite(Number(x.used_percentage)) && Number(x.resets_at) * 1000 > now.getTime());
    if (usable.length) limits = { ...l, seven_day: l.seven_day || usable.sort((a, b) => Number(b.resets_at) - Number(a.resets_at))[0] };
  } catch {}
  // No fresh status-line reading and no --reset: use the weekly reset the user saved with `calibrate` (governor.json calib.resetsAt, seconds)
  // before the Sunday 07:00 default, which is wrong for any other reset day. A reset that just passed has already rolled to the next week.
  let calibStart = null;
  if (!limits && !arg("reset", null)) {
    try {
      const calib = JSON.parse(fs.readFileSync(path.join(homeDir(), ".claude", "usage-max", "governor.json"), "utf8")).calib;
      const at = calib && Number(calib.resetsAt) * 1000;
      if (Number.isFinite(at) && at > 0 && at > now.getTime() - 7 * 86400000) calibStart = new Date(at > now.getTime() ? at - 7 * 86400000 : at);
    } catch (e) { calibStart = null; }
  }
  const resetSpec = limits ? { source: "plan (status line)" } : calibStart ? { source: "calibration (governor.json, saved weekly reset)" } : resolveResetSpec(arg("reset", null), homeDir());
  const reset = limits ? new Date(Number(limits.seven_day.resets_at) * 1000 - 7 * 86400000) : calibStart || weeklyStart(now, resetSpec);
  const windows = { last5h: now.getTime() - 5 * 60 * 60 * 1000 };
  const dir = arg("projects-dir", path.join(homeDir(), ".claude", "projects"));
  const weeklyUsed = arg("weekly-used-percent", null);
  const expectOpus = arg("expect-opus-turns", null);
  const weekly = await summarizeProjects({
    projectsDir: dir,
    since: reset.getTime(),
    windows,
    toolCallSpike: Number(arg("tool-call-threshold", 25)),
    contextSpike: Number(arg("context-threshold", 200000))
  });
  const days = Math.max(1 / 24, (now.getTime() - reset.getTime()) / 86400000); // real elapsed days (floor one hour); the first day is labelled low confidence below
  const burnPerDay = weekly.ranges.all.context / days;
  const cacheShare = weekly.ranges.all.context > 0
    ? (weekly.ranges.all.created + weekly.ranges.all.read) / weekly.ranges.all.context
    : 0;
  const modelRows = Object.entries(weekly.models)
    .sort((a, b) => b[1].context - a[1].context)
    .map(([model, bucket]) => ({
      model,
      family: modelFamily(model),
      turns: bucket.turns,
      sidechainTurns: bucket.sidechainTurns,
      context: bucket.context,
      cost: bucket.cost,
      last5hContext: bucket.ranges.last5h ? bucket.ranges.last5h.context : 0,
      last5hTurns: bucket.ranges.last5h ? bucket.ranges.last5h.turns : 0
    }));
  const opusTurns = modelRows.filter((row) => row.family === "opus").reduce((sum, row) => sum + row.turns, 0);
  const fableTurns = modelRows.filter((row) => row.family === "fable").reduce((sum, row) => sum + row.turns, 0);
  const aboveCeiling = modelRows.filter((row) => ceilingStatus(row.model) === "above").map((row) => ({ model: row.model, turns: row.turns }));
  const unknownModels = modelRows.filter((row) => ceilingStatus(row.model) === "unknown").map((row) => ({ model: row.model, turns: row.turns }));
  const sidechainOpusTurns = modelRows.filter((row) => row.family === "opus").reduce((sum, row) => sum + row.sidechainTurns, 0);
  // Hub runs on Opus 5.5 by design. Compliance = nothing above the ceiling + subagents stay on Haiku/Sonnet.
  let compliance = {
    declaredOpusTurns: expectOpus === null ? null : Number(expectOpus),
    actualOpusTurns: opusTurns,
    sidechainOpusTurns,
    aboveCeiling,
    unknownModels,
    status: aboveCeiling.length > 0 ? "fail" : sidechainOpusTurns > 0 || unknownModels.length > 0 ? "review" : "pass"
  };
  if (expectOpus !== null && Number(expectOpus) !== opusTurns) compliance.status = "fail";
  let projection = { weeklyUsedPercent: weeklyUsed === null ? null : Number(weeklyUsed), dailyPercent: null, projectedDaysLeft: null, projectedCapDate: null, source: weeklyUsed === null ? null : "arg" };
  const readingAgeHours = limits && Number.isFinite(Date.parse(limits.capturedAt)) ? Math.max(0, (now.getTime() - Date.parse(limits.capturedAt)) / 3600000) : Infinity; // no capture time = treated as stale
  const livePace = limits ? pace(limits.seven_day, 7 * 86400, now.getTime()) : null;
  if (weeklyUsed === null && livePace) {
    projection = {
      weeklyUsedPercent: livePace.used, source: `plan, captured ${limits.capturedAt}${readingAgeHours > 6 ? ` (${readingAgeHours >= 48 ? Math.round(readingAgeHours / 24) + " days" : Math.round(readingAgeHours) + " hours"} old: STALE, open Claude Code for a fresh reading)` : ""}`, stale: readingAgeHours > 6, readingAgeHours: roundDecimal(readingAgeHours, 1),
      dailyPercent: livePace.elapsed > 0 ? livePace.used / (livePace.elapsed * 7) : null,
      projectedAtReset: livePace.projected, state: livePace.state, hoursToReset: livePace.hoursLeft,
      projectedDaysLeft: livePace.capInHours === null ? null : livePace.capInHours / 24,
      projectedCapDate: livePace.state === "over" ? new Date(now.getTime() + livePace.capInHours * 3600000).toISOString() : null,
      fiveHourUsedPercent: limits.five_hour ? limits.five_hour.used_percentage : null
    };
  } else if (weeklyUsed !== null) {
    const used = Number(weeklyUsed);
    const daily = used / days;
    projection.dailyPercent = Number.isFinite(daily) ? daily : null;
    projection.confidence = days < 1 ? "low (under a day into the week: one busy morning looks like a whole week)" : "ok";
    if (daily > 0) {
      const left = (100 - used) / daily;
      projection.projectedDaysLeft = left;
      projection.projectedCapDate = new Date(now.getTime() + left * 86400000).toISOString();
    }
  }
  const result = {
    generatedAt: now.toISOString(),
    projectsDir: dir,
    weeklyResetLocal: reset.toString(),
    weeklyResetSource: resetSpec.source,
    daysSinceReset: roundDecimal(days, 2),
    weekly: {
      files: weekly.files,
      assistantTurns: weekly.assistantTurns,
      sidechainTurns: weekly.sidechainTurns,
      context: weekly.ranges.all.context,
      cost: weekly.ranges.all.cost,
      costPerDay: weekly.ranges.all.cost / days,
      last5hCost: weekly.ranges.last5h.cost,
      cacheShare: roundDecimal(cacheShare, 4),
      last5hContext: weekly.ranges.last5h.context,
      burnContextPerDay: Math.round(burnPerDay)
    },
    models: modelRows,
    compliance: { ...compliance, fableTurns, fableStatus: fableTurns === 0 ? "pass" : "fail" },
    projection,
    spikes: weekly.spikes.slice(0, 10),
    note: "Local transcripts cannot report subscription-limit percentages. Pass --weekly-used-percent from Settings > Usage for cap-day projection."
  };
  // Cost-weighted burn: cache reads are ~1/10th the price of writes, so raw token counts mislead.
  // %/day uses the governor's calibration (plan % per list-price dollar) when it has one.
  let govK = null;
  try { govK = JSON.parse(fs.readFileSync(path.join(homeDir(), ".claude", "usage-max", "governor.json"), "utf8")).k || null; } catch {}
  result.weekly.pctPerDay = govK ? roundDecimal(govK * result.weekly.costPerDay, 2) : null;
  result.weekly.checkpoint = result.weekly.pctPerDay === null ? null : result.weekly.pctPerDay <= 14 ? "ok (<=14%/day)" : "OVER 14%/day";
  const statusFile = arg("write-status", null);
  if (statusFile) {
    writeStatus(statusFile, {
      generatedAt: result.generatedAt,
      contextPerDay: result.weekly.burnContextPerDay,
      last5hContext: result.weekly.last5hContext,
      opusTurns: result.compliance.actualOpusTurns,
      opusStatus: result.compliance.status,
      fableTurns: result.compliance.fableTurns,
      projectedDaysLeft: result.projection.projectedDaysLeft
    });
  }
  if (result.compliance.status === "fail" || result.compliance.fableStatus === "fail") process.exitCode = 2;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`usage-max usage-check: ${result.generatedAt}`);
  console.log(`reset: ${result.weeklyResetLocal} (${result.daysSinceReset}d ago, source=${result.weeklyResetSource}; set with --reset "sun 07:00", USAGE_MAX_RESET, or ~/.claude/usage-max/config.json)`);
  console.log(`weekly tokens: context=${formatNumber(result.weekly.context)} cacheShare=${fixedDecimal(result.weekly.cacheShare * 100, 1)}% burn/day=${formatNumber(result.weekly.burnContextPerDay)} last5h=${formatNumber(result.weekly.last5hContext)}`);
  console.log(`weekly spend (list price, deduped): $${fixedDecimal(result.weekly.cost, 2)} = $${fixedDecimal(result.weekly.costPerDay, 2)}/day, last 5h $${fixedDecimal(result.weekly.last5hCost, 2)}${result.weekly.pctPerDay === null ? "; %/day unknown until the budget is calibrated" : `; ~${fixedDecimal(result.weekly.pctPerDay, 2)}%/day -> ${result.weekly.checkpoint}`}`);
  console.log("models this week:");
  for (const row of result.models) {
    console.log(`  ${row.model}: turns=${row.turns} sidechain=${row.sidechainTurns} context=${formatNumber(row.context)} cost=$${fixedDecimal(row.cost, 2)} last5h=${formatNumber(row.last5hContext)}`);
  }
  const c = result.compliance;
  console.log(`compliance: status=${c.status} ceiling=opus-5.5 above=${c.aboveCeiling.length ? c.aboveCeiling.map((r) => `${r.model}(${r.turns})`).join(",") : "none"} sidechainOpus=${c.sidechainOpusTurns} unknown=${c.unknownModels.length ? c.unknownModels.map((r) => r.model).join(",") : "none"} hubOpusTurns=${c.actualOpusTurns}${c.declaredOpusTurns === null ? "" : ` declared=${c.declaredOpusTurns}`}`);
  if (result.projection.state) {
    const pj = result.projection;
    const verdict = pj.state === "over" ? `OVER PACE — cap ${pj.projectedCapDate}, ${fixedDecimal(pj.hoursToReset - pj.projectedDaysLeft * 24, 0)}h before reset` : pj.state === "under" ? `UNDER PACE — ~${Math.round(100 - pj.projectedAtReset)}% of the week would go unused; spend more` : "on pace";
    console.log(`plan: week ${pj.weeklyUsedPercent}% used, ${pj.hoursToReset.toFixed(0)}h to reset, projected ~${Math.round(pj.projectedAtReset)}% at reset → ${verdict}${pj.fiveHourUsedPercent === null ? "" : `; 5h window ${pj.fiveHourUsedPercent}%`} (source: ${pj.source})`);
  } else if (result.projection.weeklyUsedPercent !== null) {
    console.log(`projection: used=${result.projection.weeklyUsedPercent}% daily=${result.projection.dailyPercent === null ? "n/a" : fixedDecimal(result.projection.dailyPercent, 2)}% left=${result.projection.projectedDaysLeft === null ? "n/a" : fixedDecimal(result.projection.projectedDaysLeft, 1)}d cap=${result.projection.projectedCapDate || "n/a"}`);
  } else {
    console.log("projection: no plan snapshot yet — it appears after the status line renders once in a logged-in session (or pass --weekly-used-percent)");
  }
  if (result.spikes.length > 0) {
    console.log("largest turns:");
    for (const spike of result.spikes.slice(0, 5)) {
      console.log(`  ${spike.project}/${spike.session}: model=${spike.model} tools=${spike.toolCalls} context=${formatNumber(spike.context)}`);
    }
  }
}

await main();
