#!/usr/bin/env node
// stdin filter: keep first HEAD + last TAIL lines and every error/warning/fail line; collapse the rest. It STREAMS (see StreamTrimmer): partial output shows while the command runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { StringDecoder } from "node:string_decoder";
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
const SIG = /\b(error|fail(ed|ure|ing)?|fatal|panic|exception|traceback|warn(ing)?|✗|✖|assert)/i;
const MB = 1048576, SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
// True when saveFull() has a fair chance of working (the filter is loaded and the data folder exists or can be made). Does not create anything. When it says no, the
// trimmer does not trim at all: every line is printed as it arrives, because trimmed text with no saved copy would lose the cut lines for good.
export function canSave(home = process.env.USAGE_MAX_HOME || os.homedir()) {
  if (!redact) return false;
  let p = path.join(home, ".usage-max", "full-output");
  for (;;) {
    try { if (!fs.statSync(p).isDirectory()) return false; fs.accessSync(p, fs.constants.W_OK | fs.constants.X_OK); return true; } catch (e) { if (!e || e.code !== "ENOENT") return false; }
    const up = path.dirname(p); if (up === p) return false; p = up;
  }
}
// Streaming version of trim(). Same final text as trim() for a command that finishes (first `head` lines, every error/warning line and the line after it
// within the `max` budget, last `tail` lines, "[usage-max: N lines trimmed]" between), but nothing waits for the end:
//   - the first `head` lines are printed the moment they arrive;
//   - later lines wait in a small window (tail + hold lines) while they are scanned; a line leaving the window is printed if it is an error/warning line
//     (or the one after it), otherwise it is counted as trimmed; the last `tail` lines are printed at the end;
//   - the window is also printed after `quietMs` without output, when its oldest line is `maxAgeMs` old, and on SIGTERM/SIGINT/SIGHUP (see streamStdin), so a
//     slow, hung, backgrounded or killed command still shows what it printed. Whatever was printed that way is simply shown in full.
// Nothing is lost: the complete raw output is kept in memory (up to rawCap bytes) and written to the full-output file at the end (conclude()). If that save
// fails, the lines that were left out are printed then. A line over lineCap characters is cut for display (the saved copy keeps it whole).
// Memory: rawCap + the window (<= tail+hold lines of <= lineCap) + roughly 3x rawCap for a moment while the copy is joined, redacted and written.
export class StreamTrimmer {
  constructor(o = {}) {
    this.head = o.head ?? 30; this.tail = o.tail ?? 60; this.hold = o.hold ?? 20; this.max = o.max ?? 160;
    this.rawCap = o.rawCap ?? 64 * MB; this.lineCap = o.lineCap ?? MB; this.quietMs = o.quietMs ?? 1000; this.maxAgeMs = o.maxAgeMs ?? 10000;
    this.write = o.write || ((s) => process.stdout.write(s)); this.save = o.save || ((raw) => saveFull(raw)); this.now = o.now || Date.now; this.pass = !!o.pass;
    this.dec = new StringDecoder("utf8"); this.n = 0; this.ring = []; this.dropped = 0; this.droppedTotal = 0; this.gaps = []; this.size = this.head + this.tail; this.ctx = false;
    this.partial = ""; this.partialLen = 0; this.partialOut = 0; this.pendingSince = null;
    this.chunks = []; this.rawSize = 0; this.rawCut = false; this.rawBytes = 0; this.outBytes = 0; this.lastAt = this.now(); this.full = false; this.done = false; this.rawStr = null;
  }
  out(s) { if (s.length) { this.outBytes += Buffer.byteLength(s); if (this.write(s) === false) this.full = true; } }
  show(e) { this.out(e.text.slice(e.pre) + (e.nl ? "\n" : "")); }
  marker() { if (this.dropped) { this.out(`[usage-max: ${this.dropped} lines trimmed]\n`); this.dropped = 0; } }
  // The line leaving the window. `nextInTail`: the line after it is one of the last `tail` lines (so it is printed anyway and costs no budget).
  drop(e, nextInTail) {
    const present = this.ctx; this.ctx = false; let keep = present || e.pre > 0;
    if (e.sig && this.size < this.max) { keep = true; if (!present) this.size++; if (!nextInTail) this.size++; this.ctx = true; }
    if (keep) { this.marker(); this.show(e); return; }
    this.dropped++; this.droppedTotal++; const g = this.gaps[this.gaps.length - 1];
    if (g && g[1] === e.i) g[1]++; else this.gaps.push([e.i, e.i + 1]);
  }
  line(text, nl, pre) {
    const i = this.n++, e = { i, text, nl, pre, sig: false, t: this.lastAt };
    if (i < this.head) { this.show(e); if (i === this.head - 1 && SIG.test(text) && this.size < this.max) { this.size++; this.ctx = true; } return; }
    e.sig = SIG.test(text); this.ring.push(e);
    if (this.ring.length > this.tail + this.hold) this.drop(this.ring.shift(), this.ring.length <= this.tail);
  }
  completeLine(nl) {
    const cut = this.partialLen - this.partial.length;
    const text = cut > 0 ? `${this.partial} [usage-max: this line is ${this.partialLen.toLocaleString("en-US")} characters long; cut after ${this.partial.length.toLocaleString("en-US")}]` : this.partial;
    const pre = Math.min(this.partialOut, text.length); this.partial = ""; this.partialLen = 0; this.partialOut = 0; this.pendingSince = null; this.line(text, nl, pre);
  }
  piece(s) {
    if (!s) return; this.partialLen += s.length; if (this.pendingSince === null) this.pendingSince = this.now();
    const room = this.lineCap - this.partial.length; if (room > 0) this.partial += s.length <= room ? s : s.slice(0, room);
  }
  push(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)); this.rawBytes += b.length; this.lastAt = this.now();
    if (this.pass) { this.outBytes += b.length; if (this.write(b) === false) this.full = true; return; }
    if (this.rawSize < this.rawCap) { const k = b.length <= this.rawCap - this.rawSize ? b : b.subarray(0, this.rawCap - this.rawSize); this.chunks.push(k); this.rawSize += k.length; if (k.length < b.length) this.rawCut = true; } else this.rawCut = true;
    const s = this.dec.write(b); let pos = 0, i;
    while ((i = s.indexOf("\n", pos)) >= 0) { this.piece(s.slice(pos, i)); this.completeLine(true); pos = i + 1; }
    this.piece(s.slice(pos));
  }
  // Print what is held now (it is then shown in full), and the unfinished last line so far.
  flush() {
    const more = this.partial.length > this.partialOut; if (!this.ring.length && !more) return;
    this.marker(); const r = this.ring; this.ring = []; this.ctx = false; for (const e of r) this.show(e);
    if (more) { this.out(this.partial.slice(this.partialOut)); this.partialOut = this.partial.length; this.pendingSince = null; }
  }
  tick(now = this.now()) {
    const held = this.ring.length ? this.ring[0].t : this.partial.length > this.partialOut ? this.pendingSince : null;
    if (held !== null && (now - this.lastAt >= this.quietMs || now - held >= this.maxAgeMs)) this.flush();
  }
  // End of input. Prints the last lines; returns what happened (the caller then calls conclude()).
  finish() {
    if (this.done) return this.stats(); this.done = true;
    if (!this.pass) {
      this.lastAt = this.now(); this.piece(this.dec.end()); this.completeLine(false); // the text after the last newline (possibly empty) is the last line, as with split("\n")
      if (this.n > this.head + this.tail + this.hold) while (this.ring.length > this.tail) this.drop(this.ring.shift(), this.ring.length <= this.tail);
      this.flush();
    }
    return this.stats();
  }
  stats() { return { trimmed: this.droppedTotal > 0, rawBytes: this.rawBytes, outBytes: this.outBytes }; }
  rawText() {
    if (this.rawStr === null) {
      this.rawStr = Buffer.concat(this.chunks).toString("utf8"); this.chunks = [];
      if (this.rawCut) this.rawStr += `\n[usage-max: the output was ${Math.ceil(this.rawBytes / MB)} MB; this copy stops after the first ${Math.round(this.rawCap / MB)} MB, the rest was not kept]\n`;
    }
    return this.rawStr;
  }
  // After finish() or flush(): when lines were left out, save the complete output and return the pointer text to print. If the save fails, print the left-out lines instead.
  conclude() {
    if (this.pass || !this.droppedTotal) return ""; const raw = this.rawText(); let sf = null;
    try { sf = this.save(raw); } catch (e) { sf = null; }
    const cap = this.rawCut ? `${Math.round(this.rawCap / MB)} MB of ${Math.ceil(this.rawBytes / MB)} MB` : "";
    if (sf) { const where = String(sf).replace(/\\/g, "/"); return this.rawCut ? `\n[usage-max: output was trimmed; only the first ${cap} is saved at ${where}; the rest was not kept]` : `\n[usage-max: output was trimmed; the complete output is saved at ${where}]`; }
    const lines = raw.split("\n"), have = this.rawCut ? lines.length - 1 : lines.length; let lost = 0, txt = "";
    for (const [a, b] of this.gaps) { for (let k = a; k < b; k++) { if (k < have) txt += lines[k] + "\n"; else lost++; } }
    return `\n[usage-max: could not save the complete output; here are the lines that were left out]\n${txt}` + (lost ? `[usage-max: ${lost} more lines were left out and could not be kept (the output was over ${Math.round(this.rawCap / MB)} MB)]\n` : "");
  }
}
// Pauses the sources while the reader of our stdout is behind, so a slow reader cannot make us buffer a whole run.
export function throttle(T, sources, out = process.stdout) {
  const act = () => { if (!T.full) return; T.full = false; const live = sources.filter(Boolean); for (const s of live) s.pause(); out.once("drain", () => { for (const s of live) s.resume(); }); };
  return act;
}
// Shared by the stdin filter and run-trimmed: timers, signals, ending. `src` = the streams feeding T. Returns { end(), onData }.
export function attach(T, src, onDone = () => {}) {
  const out = process.stdout, slow = throttle(T, src); out.on("error", () => process.exit(0)); // the reader went away: nothing left to show
  const timer = setInterval(() => T.tick(), 250); timer.unref(); const handlers = {};
  const unhook = () => { clearInterval(timer); for (const s of SIGNALS) if (handlers[s]) process.off(s, handlers[s]); };
  for (const sig of SIGNALS) {
    handlers[sig] = () => { // flush what is held, try to save the complete copy, then die of the same signal
      if (T.done) return; unhook(); let note = "";
      try { T.flush(); T.done = true; note = T.conclude(); } catch (e) { note = ""; }
      const die = () => { try { process.kill(process.pid, sig); } catch (e) { process.exit(128 + (os.constants.signals[sig] || 15)); } setTimeout(() => process.exit(128 + (os.constants.signals[sig] || 15)), 1000); };
      out.write(note, die);
    };
    process.on(sig, handlers[sig]);
  }
  const end = () => {
    if (T.done) return; unhook(); const r = T.finish(); const note = T.conclude(); if (note) out.write(note); onDone(r, note);
  };
  return { end, data: (d) => { T.push(d); slow(); } };
}
// stdin -> stdout filter (the hook wraps commands as `cmd 2>&1 | node trim.mjs`).
export function streamStdin(onDone = () => {}) {
  const T = new StreamTrimmer({ pass: !canSave() }), a = attach(T, [process.stdin], onDone);
  process.stdin.on("data", a.data); process.stdin.on("end", a.end); process.stdin.on("error", a.end);
}
// Whole-text version, kept for callers that have the complete text: prints the trimmed text only when the complete output was saved first. If the copy cannot be
// saved (disk full, read-only folder, filter missing), the whole output is returned instead, because trimmed text with no copy and no hint would lose it for good.
export function renderTrimmed(raw, opts, save = saveFull) {
  const out = trim(raw, opts); if (out === raw) return { text: raw, trimmed: false };
  const sf = save(raw); if (!sf) return { text: raw, trimmed: false, saveFailed: true };
  return { text: `${out}\n[usage-max: output was trimmed; the complete output is saved at ${sf.replace(/\\/g, "/")}]`, trimmed: true, out };
}
if (process.argv[1] && process.argv[1].endsWith("trim.mjs")) {
  streamStdin(async (r) => {
    try { if (!process.env.CODEX_HOME && r.trimmed) { const [{ dataDir }, { recordBytes }] = await Promise.all([import("./meter.mjs"), import("./trimtest.mjs")]); recordBytes(dataDir(), r.rawBytes, r.outBytes); } } catch (e) { void e; } // the saving counter is best effort
  });
}
