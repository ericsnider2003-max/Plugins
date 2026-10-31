---
name: ugc-recording-to-review
description: First-cut a raw recording (or a cloned-voice track plus footage) into a tight 9:16 EDL - transcript word timings, filler and retake removal, pause shortening - then render, gate, and send it to the Review Room for Eric's notes and approval. Use for "cut this recording", "first cut", "review a draft", "apply my notes", "finish the approved one".
---

# Recording to review (UGC, Windows)

Operate from `<UGC_HOME>`; interpreter `voice\venv\Scripts\python.exe`. Depends on `ugc-video-editing` (STYLES.md, Inbox, ledger).

## The first cut is data, not ffmpeg

`pipeline\first_cut.py` emits an **EDL v1.1** for `edl\edl_finish.py`:

- **recording mode** - talking head with its own audio: timeline of jump-cut segments of the same source, `audio:true`, `fit:"cover"`
  (16:9 → 9:16 crop, `focus_x` = where to look), `voiceover.file:"__clip_audio__"`, retimed word captions.
- **voice mode** - cloned voice (F5-TTS wav from `voice\`) + footage: VO is tightened to a new wav, footage cycles under it
  (never the invented UI: the demo shots must be the real screen recording), captions retimed to the tightened VO.

Steps inside (all automatic, reported in `first_cut` on the ledger item):
1. Word timings: Cloudflare Workers AI first, local faster-whisper fallback. Use `--verbatim` if fillers are being dropped by the transcriber.
2. Snap word edges to measured silences (Whisper blurs word edges into pauses).
3. Remove filler words (style `fillers`, `filler_phrases`) and restarted lines (a repeated 3+ word run → keep the later take).
4. Shorten every pause over the style's `pause_ms` to that limit (air kept both sides); re-measure the cut audio and trim any silence still over the limit (up to 2 rounds) - only between words.
5. Flag, don't fix: length vs target, banned phrases (`never_say`), near-miss spellings of `exact_terms`, no CTA in the last ~4 s.
6. Hook-first reordering and claim checking are judgment calls: propose them to Eric, then edit the EDL timeline order; never reorder silently.

## Render check = the quality gate (no separate hook)

`pipeline\gate.py` runs the rubric AUTO checks (hook caption <=1.0 s, cadence, front-load, length, caption coverage/sync, loudness, clipping, CTA)
**and** the kit's render-check rules as KIT checks: 1080x1920, audio present, -17..-12 LUFS band, true peak < -1.5 dB on finals,
no mid-clip silence over the style pause limit (+100 ms), captions in the clear area (bottom >= 20 %), no black or frozen frames, no filler words left in captions.
It writes a contact sheet (frame after every big cut + first/last 2 s, unsafe bands shaded red). Judge items stay *pending* for Eric.

## Review rounds

`pm.publish_review` makes `workspace\Review\<id>\` (720p review copy < 14 MB, versions v1, v2…). Eric watches at `http://127.0.0.1:8765/review/<id>/`
(`python -m pipeline.run serve`), pins notes to timestamps, sends or approves. Next run: `python -m pipeline.run apply` →
notes become state `revise` (note text stored as data), `run` builds v2 and moves nothing of v1.

## Finish

`python -m pipeline.run finalize <id>` (only for state `approved`): re-gates with finals rules (true peak < -1.5 dB), copies the master to `workspace\Final\<id>\`. Nothing is posted.

## Cloned voice slot

`python -m pipeline.run voice --script "..." --footage <real screen recording> --style UGC-Voiceover-Demo --name <n>`
(synthesises with F5-TTS from `voice\ref_f5.wav`, then runs the same chain). The quality bar from the pipeline docs still applies:
interim voices and mockup footage are previews, never samples for Eric.
