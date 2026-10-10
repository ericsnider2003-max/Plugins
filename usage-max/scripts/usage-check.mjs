#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { summarizeProjects, modelFamily, weeklyStart, resolveResetSpec, ceilingStatus, formatNumber, pace } from "./lib.mjs";

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
    if (l.seven_day && l.seven_day.resets_at * 1000 > now.getTime()) limits = l;
  } catch {}
  const resetSpec = limits ? { source: "plan (status line)" } : resolveResetSpec(arg("reset", null), homeDir());
  const reset = limits ? new Date(limits.seven_day.resets_at * 1000 - 7 * 86400000) : weeklyStart(now, resetSpec);
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
  const days = Math.max(1, (now.getTime() - reset.getTime()) / 86400000);
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
  const livePace = limits ? pace(limits.seven_day, 7 * 86400, now.getTime()) : null;
  if (weeklyUsed === null && livePace) {
    projection = {
      weeklyUsedPercent: livePace.used, source: `plan, captured ${limits.capturedAt}`,
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
    daysSinceReset: Number(days.toFixed(2)),
    weekly: {
      files: weekly.files,
      assistantTurns: weekly.assistantTurns,
      sidechainTurns: weekly.sidechainTurns,
      context: weekly.ranges.all.context,
      cacheShare: Number(cacheShare.toFixed(4)),
      last5hContext: weekly.ranges.last5h.context,
      burnContextPerDay: Math.round(burnPerDay)
    },
    models: modelRows,
    compliance: { ...compliance, fableTurns, fableStatus: fableTurns === 0 ? "pass" : "fail" },
    projection,
    spikes: weekly.spikes.slice(0, 10),
    note: "Local transcripts cannot report subscription-limit percentages. Pass --weekly-used-percent from Settings > Usage for cap-day projection."
  };
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
  console.log(`weekly tokens: context=${formatNumber(result.weekly.context)} cacheShare=${(result.weekly.cacheShare * 100).toFixed(1)}% burn/day=${formatNumber(result.weekly.burnContextPerDay)} last5h=${formatNumber(result.weekly.last5hContext)}`);
  console.log("models this week:");
  for (const row of result.models) {
    console.log(`  ${row.model}: turns=${row.turns} sidechain=${row.sidechainTurns} context=${formatNumber(row.context)} last5h=${formatNumber(row.last5hContext)}`);
  }
  const c = result.compliance;
  console.log(`compliance: status=${c.status} ceiling=opus-5.5 above=${c.aboveCeiling.length ? c.aboveCeiling.map((r) => `${r.model}(${r.turns})`).join(",") : "none"} sidechainOpus=${c.sidechainOpusTurns} unknown=${c.unknownModels.length ? c.unknownModels.map((r) => r.model).join(",") : "none"} hubOpusTurns=${c.actualOpusTurns}${c.declaredOpusTurns === null ? "" : ` declared=${c.declaredOpusTurns}`}`);
  if (result.projection.state) {
    const pj = result.projection;
    const verdict = pj.state === "over" ? `OVER PACE — cap ${pj.projectedCapDate}, ${(pj.hoursToReset - pj.projectedDaysLeft * 24).toFixed(0)}h before reset` : pj.state === "under" ? `UNDER PACE — ~${Math.round(100 - pj.projectedAtReset)}% of the week would go unused; spend more` : "on pace";
    console.log(`plan: week ${pj.weeklyUsedPercent}% used, ${pj.hoursToReset.toFixed(0)}h to reset, projected ~${Math.round(pj.projectedAtReset)}% at reset → ${verdict}${pj.fiveHourUsedPercent === null ? "" : `; 5h window ${pj.fiveHourUsedPercent}%`} (source: ${pj.source})`);
  } else if (result.projection.weeklyUsedPercent !== null) {
    console.log(`projection: used=${result.projection.weeklyUsedPercent}% daily=${result.projection.dailyPercent === null ? "n/a" : result.projection.dailyPercent.toFixed(2)}% left=${result.projection.projectedDaysLeft === null ? "n/a" : result.projection.projectedDaysLeft.toFixed(1)}d cap=${result.projection.projectedCapDate || "n/a"}`);
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
