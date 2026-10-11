#!/usr/bin/env node
// usage-max resume: print the automatic resume point for this folder (what the next fresh session here will be told).
import fs from "node:fs";
import path from "node:path";
import { sharedDir, resumeFile } from "./resume.mjs";
import { redact } from "./memory.mjs";
if (process.argv.includes("--repo")) { // for Codex cloud/mobile: they read only the repo, so put the note there (committed, redacted)
  try {
    const t = redact(fs.readFileSync(resumeFile(sharedDir(), process.cwd()), "utf8")); const d = path.join(process.cwd(), ".codex-tasks"); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "RESUME.md"), t + "\nContinue the work described above unless the task says otherwise.\n");
    console.log("saved .codex-tasks/RESUME.md. Commit and push it, then in the Codex app (desktop or mobile) say:\n  Continue from .codex-tasks/RESUME.md");
  } catch { console.log("no resume point for this folder yet."); }
  process.exit(0);
}
try { console.log(fs.readFileSync(resumeFile(sharedDir(), process.cwd()), "utf8")); } catch { console.log("no resume point for this folder yet. One is saved automatically at the end of each assistant turn."); }
