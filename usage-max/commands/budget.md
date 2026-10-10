---
description: Budget governor — show mode and burn vs the sustainable rate, calibrate from Settings > Usage, or pin a mode.
argument-hint:
- status | calibrate <pct> --resets <date> | mode <auto|green|amber|red>
---

# /budget

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/governor.mjs" $ARGUMENTS
```

Relay the output in two or three lines: mode, estimated weekly %, burn vs sustainable, and what new sessions will start on. If it says there is no calibration, ask the user for the weekly % and reset time shown in Settings > Usage and run `calibrate`. Do not run anything else.
