# Usage-max visible browser adapter

This optional Chromium/Edge MV3 extension observes only visible model labels and
explicit visible usage/quota percentages on ChatGPT and Claude web pages. It does not read
cookies, local storage, prompts, replies, conversation IDs, or provider APIs.
Generic percentages are ignored; only labels that explicitly say used, usage,
quota, rate limit, remaining, or left are considered. If no model label is
visible, it sends an unknown model rather than guessing.

One-time setup:

1. Start `node scripts/usage-max.mjs attachments serve` and keep the printed
   loopback endpoint/token private.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select this `browser-adapter` folder.
3. For zero-touch bootstrap after installation, install the native host in
   dry-run mode first, then apply it with the extension ID shown by the browser:
   `node scripts/usage-max.mjs attachments native-host --extension-id <id> --apply`.
   The native host reads the already-running local receiver token and passes it
   only to the extension background worker. If the native host is not installed,
   open the extension's options and paste the endpoint and token printed by the
   receiver instead.
4. Open or refresh a supported web tab. ChatGPT captures arrive in
   `~/.usage-max/attachments/chatgpt.json`; Claude web captures arrive in
   `~/.usage-max/attachments/claude-web.json`. The Usage-max service ingests
   them on its next tick.

When the service writes a pending ChatGPT notice, the adapter polls the same
loopback server and displays it in the current page. It acknowledges the notice
only after rendering it; native ChatGPT/Cowork notification APIs are not
assumed.

The adapter is observation-only and supports the web surfaces listed above;
it does not attach to arbitrary desktop-app versions or Cowork windows. A
visible usage value is still treated as
unapproved until an account slot is approved and never enables enforcement by
itself. If the page supplies no explicit allowance signal, allowance remains
unknown.

The extension refuses endpoints that are not plain HTTP on `127.0.0.1`; the
receiver binds to loopback only.

The native host is an optional Windows-only bootstrap path. It does not grant
provider control, read cookies, or expose the token to page scripts.
