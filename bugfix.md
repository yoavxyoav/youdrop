# Bug log

## 2026-09-17 17:25 — AirDrop picker vanished the instant you clicked a recipient

**Issue.** `helper/airdrop.applescript` kept itself alive with `delay holdSeconds` after
calling `performWithItems:`. `delay` blocks the main thread, so the process had **no
running run loop**. The picker is presented *by the calling process*, so it drew fine — but
the click that selects a recipient could never be dispatched, and the window disappeared the
moment it was clicked. Reported from real use; never caught by the earlier tests, because
every test only checked that the picker *appeared*.

**Fix.** Replaced `delay` with a real run loop:

- `NSApplication sharedApplication` + `setActivationPolicy:1`
  (`NSApplicationActivationPolicyAccessory`) so `osascript` is a genuine UI process that can
  take focus — it is not one by default.
- A loop calling `NSRunLoop mainRunLoop's runUntilDate:` in 0.15s slices until the deadline,
  so events are pumped continuously while the picker is up.

**Verified.** Added an optional heartbeat argument that writes the loop counter to a file.
Ticks advanced 10 → 23 → 37 over six seconds while the picker was on screen, proving the
loop is turning. Under the old `delay` the count would never have moved.

**Failed intermediate attempt (worth recording).** The first rewrite also added an
`NSSharingServiceDelegate` script object so the process could exit as soon as the share
finished. It fails under plain `osascript` with `Can't get class "NSObject"` —
AppleScriptObjC cannot resolve `property parent : class "NSObject"` in that context. This
briefly shipped and surfaced as an "AirDrop failed" notification in Chrome. The delegate was
removed; it was an optimisation, not the fix. The helper already replaces a stale picker on
the next send, so the early exit was never load-bearing.

**Lesson.** Presenting UI is not the same as servicing it. Any process that puts a window on
screen must keep pumping its run loop, and "the window appeared in a screenshot" does not
prove it is interactive.

---

## 2026-09-17 17:30 — Timestamp silently dropped: `readyState` filter rejected a valid video

**Issue.** `readPlaybackState()` in `extension/background.js` only accepted `<video>`
elements with `readyState > 0`. YouTube reports `readyState: 0` while buffering or mid-seek
**even though `currentTime` is already correct**. On a real page this produced:

```json
{"hadVideo": false, "seconds": 0}   // element present, currentTime 135, rejected anyway
```

`hadVideo: false` meant `includeTime` was false, so the `&t=` parameter was left off entirely
and the link opened at the beginning of the video — the one thing the tool exists to do.

**Fix.**
- Dropped the `readyState` filter from `pickVideo()`; the selector already targets the real
  player element.
- Added a second, independent source: YouTube's own `#movie_player.getCurrentTime()`, used
  when the element reports 0, wrapped in try/catch for when the API is not ready.
- `hadVideo` is now true when either the element or the player object is present.

**Verified.** On a live YouTube page seeked to 2:15, the extension's exact extraction code
now returns `{"hadVideo":true,"secs":135,"includeTime":true,"timeParamThatWillBeAppended":"t=135s"}`.

**Lesson.** `readyState` describes buffering, not whether a property is readable. Guarding on
a loosely-related "is it ready" flag discarded data that was already correct — and it failed
*silently*, producing a plausible-looking link that was simply wrong.

---
## 2026-09-17 17:02 — Oversized request body dropped the socket instead of answering

**Issue.** `helper/server.js` enforced its 4 KB body cap by calling `req.destroy()` the
moment the limit was crossed. That tore down the connection before any response was
written, so a client sending an over-long URL saw
`TypeError: fetch failed / SocketError: other side closed` instead of a status code. Found
by an integration test that asserted a 400 and got a connection error.

**Fix.** `readBody` now sets a `tooLarge` flag, discards what it buffered, and keeps
draining to `end` so the response can be written normally — then rejects with an error
carrying `statusCode = 413`. A second, much higher cap (1 MB) still destroys the socket, so
a deliberate flood cannot make the helper drain forever. The handler honours
`err.statusCode` and logs the rejection.

**Verified.** `tests/integration/helper-api.test.js` now asserts a real `413` with a JSON
body matching `/body too large/`, and passes. Test name records the intent: "rejects an
oversized body with 413 **and a real response, not a dropped socket**".

**Lesson.** A size guard that kills the transport is indistinguishable from a crash at the
client. Reject loudly, drain politely, and only drop the connection when the peer is
clearly abusive.

---

## 2026-09-17 16:58 — `node --test tests/unit/` fails on Node 26

**Issue.** `node --test tests/unit/` returned `MODULE_NOT_FOUND: Cannot find module
'.../tests/unit'` — Node 26 treats a bare directory argument as a module to load rather
than a directory to expand.

**Fix.** Use a glob in `package.json`: `node --test "tests/unit/**/*.test.js"`.

**Lesson.** Not a code bug, but worth recording: the directory form used to work and
silently changed meaning. Quote the glob so the shell does not expand it first.
