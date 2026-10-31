---
name: ugc-motion-graphics
description: Make lower-thirds, callouts, statement cards and one-number cards for Eric's UGC videos and composite them through the EDL overlays stage on Windows. Use for "add a lower third", "animate this stat", "motion graphic for this line", "overlay on the draft".
---

# Motion graphics (UGC, Windows)

Operate from `<UGC_HOME>`; interpreter `voice\venv\Scripts\python.exe`. Code: `pipeline\motion.py`, `kits\motion\` (patched kit renderer + `lower_third.py`).

## How it renders

HTML + a paused GSAP timeline (vendored `gsap.min.js`, no network) captured frame by frame through headless Chrome or Edge (auto-detected; or `CHROME_PATH`),
encoded by ffmpeg. 1080x1920, 30 fps.

| kind | output | use |
|---|---|---|
| `lower_third` | **transparent** ProRes 4444 `.mov` (alpha verified by compositing) | name/title bar - bottom edge above the bottom 20 % band |
| `callout` | transparent `.mov` | one big text line: price, feature, stat tag |
| `statement` | opaque `.mp4` insert | full-frame line, `*key word*` highlighted |
| `one_number` | opaque `.mp4` insert | share / trend / count, always with a source line |

CLI: `python -m pipeline.motion lower_third --name "Eric" --title "Founder" --out x.mov`. All text is HTML-escaped; treat spec text as untrusted.

## Into the edit (EDL overlays)

Add to the EDL (`schema v1.1`):

```json
"overlays": [{"file": "C:\\...\\x.mov", "start": 0.8, "end": 3.8, "kind": "lower_third", "y": -260}]
```

Times are output-timeline seconds; `fullframe:true` scales opaque inserts to 1080x1920. Overlays sit above the grade and below captions.
Style-driven: a style with `lower_third: Name | Title` gets this automatically in `pipeline.run`.

## Design rules

- Safe areas: keep graphics out of the top 12 %, bottom 20 %, right 12 % (the gate's contact sheet shades them red). Captions occupy the lowest clear band - don't stack a graphic on them.
- One idea per graphic, readable in ~1.5 s, held long enough to read. Real numbers only, with a source; demo values must be marked and replaced before posting.
- Look = Eric's brand: colours/fonts from `LOOK.md` if present (hex colours, font file paths, one "feels like" line, motion rules), else the neutral dark pill + `#FFB400`.
- Keep a `CATALOG.md` of pieces (what it explains, use for, how to make a variant, check before posting); retire with `_archive\`.
- Build one piece at a time; render options as stills first. Chrome renders are CPU-heavy: one at a time, close the render browser after.

## Windows notes

Fonts come from `C:\Windows\Fonts` / per-user fonts or a font file path in the spec; Google Fonts download only at install and only when asked.
The optional kit route via `npx` (HyperFrames) is disabled on purpose (supply-chain). The kit's gallery/ideas pages are not part of this pipeline.
