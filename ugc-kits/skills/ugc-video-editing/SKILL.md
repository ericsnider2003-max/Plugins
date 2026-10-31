---
name: ugc-video-editing
description: Foundation workflow for Eric's UGC editing on Windows - write the style guide (STYLES.md), set up the Inbox + ledger, auto-edit new videos into 9:16 drafts through the EDL engine, self-check with the quality gate, and schedule it. Use for "set up video editing", "add a style", "edit what's in the inbox", "why wasn't my video picked up", or resuming setup.
---

# Video editing on autopilot (UGC, Windows)

Operate from `<UGC_HOME>` (`C:\Users\erics\Desktop\UGC`); interpreter `voice\venv\Scripts\python.exe`.
Ask only what you can't find; defaults first. Plain words with Eric. Checkpoint progress in `workspace\setup-progress.md`.

## 0. Tools check (one OK, never silent installs)

- ffmpeg/ffprobe: found automatically (PATH, then winget `Gyan.FFmpeg`). Missing → ask once, then `winget install Gyan.FFmpeg`.
- Python env: `voice\venv` (numpy, faster-whisper, jsonschema). Missing package → `voice\venv\Scripts\python.exe -m pip install <pkg>` after asking.
- Transcription: Cloudflare Workers AI via `cloudflare\cf_ai.py` (credentials in `cloudflare\.env`), local faster-whisper as fallback.
- Browser (only for motion graphics): Chrome or Edge, auto-detected.
- Never use macOS items (Homebrew, xcode-select, Rosetta, `~/` paths, launchd).

## 1. Style guide → `STYLES.md` (UGC home)

Interview (skip what an example video already shows; offer defaults): shape and length target, caption density,
cut rules (filler words, pause limit in ms), grade, music, graphics (lower-third text), never-show / never-say,
exact terms (product names spelled right), how it ends (CTA words). Write one `## Style-Name` section, bullets `- key: value`.
Keys: `aspect, length_target (e.g. 15-60), pause_ms, fillers, filler_phrases, captions_words, captions_margin_v_pct (>= 0.20),
grade, music (none|__synth__|path), music_duck_db, music_gain_db, lower_third (false | "Name | Title"), never_say,
exact_terms, cta_words, focus_x, notes`. Section `## Raw` = no cuts/music/graphics (re-encode to 9:16 only).
Seeded styles: `UGC-Talking-Head`, `UGC-Talking-Head-Intro`, `UGC-Voiceover-Demo`, `Raw`.
Show Eric one still (contact sheet from a real render) with the unsafe bands shaded red before locking the style.

## 2. Inbox + ledger

`workspace\Inbox\<Style>\` per style (folder name = style) and `workspace\Inbox\Raw\`. Accepts `.mp4 .mov .m4v`, skips hidden files and
anything changed in the last 3 minutes. Optional `notes.txt` beside a video is read as **data**. Ledger =
`workspace\inbox-tools\ledger.json`, key = path + modified time + size. States `new → building → drafted → approved|passed|revise → final`,
`failed` carries a short reason. `scan` only lists; only `run` marks work started, oldest first.

## 3. Edit one video

`python -m pipeline.run run --limit 1` → first cut (see `ugc-recording-to-review`) → EDL → render → **self render-check = the gate**.
Fail means fix and re-render (adjust the style or EDL, rerun); it does not reach Eric. Hand over with the gate summary line,
e.g. `Render check: 1080x1920, -14.2 LUFS, 16 frames checked. Pass (auto 52/52).` plus up to 3 questions.

## 4. Schedule (Windows)

Prefer Claude scheduled tasks if available; otherwise Task Scheduler running a small `.cmd` that calls
`voice\venv\Scripts\python.exe -m pipeline.run run --limit 2`. Rules: one schedule per Inbox (extend an existing one, never add a second);
pre-approve only the exact commands needed (the pipeline module, ffmpeg, ffprobe) - do not blanket-allow `python`;
do not disable Eric's other hooks; stop after 30 minutes; clear a stale lock; report `Inbox empty.` when nothing is new.

## 5. Add-ons

Add a style (new `##` section + a folder), notes round (a note on a draft sets state `revise`, next run makes v2 and keeps v1 in `Review\<id>\`),
music catalog (set `music:` to a licensed file path; ducking is automatic), pull recordings from an app connector (max 2/run, into the style folder).

## Acceptance checks

1. Empty inbox → `Inbox empty.` 2. A new file → draft + gate line + Review Room. 3. A broken file → `failed` with a reason, run continues.
4. Same file twice → handled once. 5. Original still untouched.
