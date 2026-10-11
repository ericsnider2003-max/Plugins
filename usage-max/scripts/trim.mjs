#!/usr/bin/env node
// stdin filter: keep first HEAD + last TAIL lines and every error/warning/fail line; collapse the rest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// The trimmed middle is never gone: the whole output is kept here (newest 40 files, 2 days) and the model is told where.
export function saveFull(raw, home = process.env.USAGE_MAX_HOME || os.homedir()) {
  try {
    const d = path.join(home, ".usage-max", "full-output"); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 6)}.txt`); fs.writeFileSync(f, raw);
    const all = fs.readdirSync(d).map((n) => ({ n, t: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const x of all.slice(40)) try { fs.unlinkSync(path.join(d, x.n)); } catch {}
    for (const x of all) if (Date.now() - x.t > 2 * 864e5) try { fs.unlinkSync(path.join(d, x.n)); } catch {}
    return f;
  } catch { return null; }
}
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
if (process.argv[1] && process.argv[1].endsWith("trim.mjs")) {
  const raw = fs.readFileSync(0, "utf8"), out = trim(raw); process.stdout.write(out);
  if (out !== raw) { const sf = saveFull(raw); if (sf) process.stdout.write(`\n[usage-max: output was trimmed; the complete output is saved at ${sf.replace(/\\/g, "/")}]`); }
  try { if (!process.env.CODEX_HOME && out !== raw) { const [{ dataDir }, { recordBytes }] = await Promise.all([import("./meter.mjs"), import("./trimtest.mjs")]); recordBytes(dataDir(), Buffer.byteLength(raw), Buffer.byteLength(out)); } } catch {}
}
