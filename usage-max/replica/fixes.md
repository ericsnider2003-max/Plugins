# Fix ledger

- `FIX-021`: add `providers` command and normalized provider capture.
- `FIX-022`: preserve last-good provider data on refresh failure.
- `FIX-023`: never persist or print OAuth credentials.
- `FIX-024`: remove orphaned Codex trust records after an old upload is removed.
- `FIX-025`: add clean-room provider and lifecycle regression tests.

Deferred by design: a browser extension for Claude/Cowork/ChatGPT. Browser
endpoints are authenticated and version-internal; a later adapter must be
explicitly local, opt-in, visibly labeled as provider-reported or estimated, and
tested against the installed browser surface before it is shipped.
