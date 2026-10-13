#!/usr/bin/env node
// stdin filter: keep first HEAD + last TAIL lines and every error/warning/fail line; collapse the rest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
// Saved output is run through the secret filter first (command output can contain tokens and connection strings). If the filter cannot be
// loaded, nothing is saved rather than saving unfiltered text.
let redact = null; try { ({ redact } = await import("./memory.mjs")); } catch { try { ({ redact } = await import("../../scripts/memory.mjs")); } catch { redact = null; } }
// The trimmed middle is never gone: the whole output is kept here (newest 40 files, 2 days) and the model is told where.
export function saveFull(raw, home = process.env.USAGE_MAX_HOME || os.homedir()) {
  if (!redact) return null; raw = redact(raw);
  try {
    const d = path.join(home, ".usage-max", "full-output"); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    const f = path.join(d, `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 6)}.txt`); fs.writeFileSync(f, raw, { mode: 0o600 }); // private: command output can contain tokens
    try { // housekeeping must never lose the pointer to the file just written
      const all = fs.readdirSync(d).map((n) => { try { return { n, t: fs.statSync(path.join(d, n)).mtimeMs }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t);
      for (const x of all.slice(40)) try { fs.unlinkSync(path.join(d, x.n)); } catch {}
      for (const x of all) if (Date.now() - x.t > 2 * 864e5) try { fs.unlinkSync(path.join(d, x.n)); } catch {}
    } catch {}
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
// Prints the trimmed text only when the complete output was saved first: if the copy cannot be saved (disk full, read-only folder, filter missing), the whole output
// is printed instead, because trimmed text with no copy and no hint would lose it for good.
export function renderTrimmed(raw, opts, save = saveFull) {
  const out = trim(raw, opts); if (out === raw) return { text: raw, trimmed: false };
  const sf = save(raw); if (!sf) return { text: raw, trimmed: false, saveFailed: true };
  return { text: `${out}\n[usage-max: output was trimmed; the complete output is saved at ${sf.replace(/\\/g, "/")}]`, trimmed: true, out };
}
if (process.argv[1] && process.argv[1].endsWith("trim.mjs")) process.stdout.write(renderTrimmed(fs.readFileSync(0, "utf8")).text);
