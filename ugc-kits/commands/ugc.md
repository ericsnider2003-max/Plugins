---
description: Run or inspect the UGC pipeline (status | scan | run | apply | finalize <id> | serve)
argument-hint: status | scan | run | apply | finalize <id> | serve
---

Use the `ugc-pipeline` skill. Run from the UGC home (default `C:\Users\erics\Desktop\UGC`, or `$UGC_HOME`)
with the project interpreter, one command, no shell tricks:

`C:\Users\erics\Desktop\UGC\voice\venv\Scripts\python.exe -m pipeline.run $ARGUMENTS`

If no argument was given, run `status` and summarise: what is drafted and waiting for approval, what failed
and why (quote the gate reasons), and the single next action. Never approve, finalize, or post on the user's
behalf unless they said so in this chat.
