#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { summarizeProjects, topEntries, formatNumber } from "./lib.mjs";

function arg(name, fallback = null) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

function homeDir() {
  return process.env.USAGE_MAX_HOME || os.homedir();
}

function projectsDir() {
  return arg("projects-dir", path.join(homeDir(), ".claude", "projects"));
}

function modelTable(models) {
  return Object.entries(models)
    .sort((a, b) => b[1].context - a[1].context)
    .map(([model, bucket]) => ({
      model,
      turns: bucket.turns,
      sidechainTurns: bucket.sidechainTurns,
      input: bucket.input,
      output: bucket.output,
      created: bucket.created,
      read: bucket.read,
      context: bucket.context,
      thinking: bucket.thinking,
      toolCalls: bucket.toolCalls
    }));
}

function repeated(map, limit = 5) {
  return Object.entries(map)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

async function main() {
  const dir = projectsDir();
  const asJson = process.argv.includes("--json");
  const [allTime, last7d] = await Promise.all([
    summarizeProjects({ projectsDir: dir }),
    summarizeProjects({ projectsDir: dir, since: Date.now() - 7 * 24 * 60 * 60 * 1000 })
  ]);
  const result = {
    generatedAt: new Date().toISOString(),
    projectsDir: dir,
    allTime: {
      files: allTime.files,
      assistantTurns: allTime.assistantTurns,
      sidechainTurns: allTime.sidechainTurns,
      models: modelTable(allTime.models),
      topProjects: topEntries(allTime.projects, 10),
      topSessions: topEntries(allTime.sessions, 10).map((entry) => ({
        session: entry.session,
        project: entry.project,
        turns: entry.turns,
        context: entry.context
      }))
    },
    last7d: {
      files: last7d.files,
      assistantTurns: last7d.assistantTurns,
      sidechainTurns: last7d.sidechainTurns,
      models: modelTable(last7d.models),
      topProjects: topEntries(last7d.projects, 10),
      topSpikes: last7d.spikes.slice(0, 5),
      repeatedFiles: repeated(last7d.rework.repeatedFiles),
      repeatedCommands: repeated(last7d.rework.repeatedCommands)
    },
    note: "Local transcript audit only. It does not include claude.ai chat, Cowork cloud sessions, other devices, or subscription-limit percentages."
  };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`usage-max audit: ${result.generatedAt}`);
  console.log(`projects: ${dir}`);
  for (const section of [["all-time", result.allTime], ["last-7-days", result.last7d]]) {
    console.log(`\n[${section[0]}] files=${section[1].files} turns=${section[1].assistantTurns} sidechain=${section[1].sidechainTurns}`);
    for (const row of section[1].models) {
      console.log(`  ${row.model}: turns=${row.turns} sidechain=${row.sidechainTurns} context=${formatNumber(row.context)} in=${formatNumber(row.input)} out=${formatNumber(row.output)} created=${formatNumber(row.created)} read=${formatNumber(row.read)} thinking=${formatNumber(row.thinking)} tools=${row.toolCalls}`);
    }
  }
  console.log("\nTop projects (all-time):");
  for (const row of result.allTime.topProjects) console.log(`  ${row.name}: context=${formatNumber(row.context)} turns=${row.turns}`);
  console.log("\nTop per-turn spikes (last 7d):");
  for (const spike of result.last7d.topSpikes) {
    console.log(`  ${spike.project}/${spike.session}: model=${spike.model} sidechain=${spike.sidechain} tools=${spike.toolCalls} context=${formatNumber(spike.context)} ts=${new Date(spike.timestamp).toISOString()}`);
  }
}

await main();
