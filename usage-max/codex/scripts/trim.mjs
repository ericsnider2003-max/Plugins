#!/usr/bin/env node
// stdin filter: keep first HEAD + last TAIL lines and every error/warning/fail line; collapse the rest.
import fs from "node:fs";
export function trim(text, { head = 30, tail = 60, max = 160 } = {}) {
  const lines = text.split("\n"); if (lines.length <= head + tail + 20) return text;
  const keep = new Set(); for (let i = 0; i < Math.min(head, lines.length); i++) keep.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) keep.add(i);
  const sig = /\b(error|fail(ed|ure|ing)?|fatal|panic|exception|traceback|warn(ing)?|✗|✖|assert)/i;
  for (let i = 0; i < lines.length && keep.size < max; i++) if (sig.test(lines[i])) { keep.add(i); if (i + 1 < lines.length) keep.add(i + 1); }
  const out = []; let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) { if (i > last + 1) out.push(`[usage-max: ${i - last - 1} lines trimmed]`); out.push(lines[i]); last = i; }
  if (last < lines.length - 1) out.push(`[usage-max: ${lines.length - 1 - last} lines trimmed]`);
  return out.join("\n");
}
if (process.argv[1] && process.argv[1].endsWith("trim.mjs")) process.stdout.write(trim(fs.readFileSync(0, "utf8")));
