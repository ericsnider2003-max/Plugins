#!/usr/bin/env node
// usage-max resume: print the automatic resume point for this folder (what the next fresh session here will be told).
import fs from "node:fs";
import { dataDir } from "./meter.mjs";
import { resumeFile } from "./resume.mjs";
try { console.log(fs.readFileSync(resumeFile(dataDir(), process.cwd()), "utf8")); } catch { console.log("no resume point for this folder yet. One is saved automatically at the end of each assistant turn."); }
