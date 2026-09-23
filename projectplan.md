# YouTube → AirDrop — Project Plan

## Goal
A Chrome extension that takes the YouTube video currently playing, at its current
timestamp, and sends it to Yoav's phone over AirDrop.

---

## 2026-09-17 16:45 — Route decision

Asked before building, because the obvious approach is impossible.

| Route | Verdict |
|---|---|
| Real AirDrop via native helper | **Chosen** |
| Push notification (ntfy/Pushover) | Rejected by user |
| Both, AirDrop with push fallback | Rejected by user |
| Universal Clipboard (`pbcopy`) | Rejected by user |

Also decided: no Linear ticket (personal project), plan reviewed in chat.

---

## 2026-09-17 16:50 — Discovery, and why the plan changed mid-flight

The approved plan was to UI-script Safari's `File ▸ Share ▸ AirDrop`. Two findings killed
that and replaced it with something better.

1. **Safari's share menu is not scriptable in any sane way.** `Share…` is a single menu
   item, not a submenu. It opens a popover whose 13 destination buttons have no
   accessibility name, no help text, no value and no children — only screen coordinates.
   Clicking "AirDrop" would mean hard-coding an index.
2. **`NSSharingService(named: .sendViaAirDrop)` is public API and works.** Probed on this
   machine: `service=present`, `canPerformWithItems(NSURL)=true`, `title=AirDrop`.
   Needs no Safari and no Accessibility permission.

Gotcha found in the probe: the service returns `false` for an `NSString`. The item must be
a real `NSURL`.

---

## 2026-09-17 16:55 — "Can't we do it in Chrome?"

Tested rather than assumed, because the web sources contradicted each other.

`navigator.share` **exists** in Chrome 153 on macOS and `canShare({url})` returns `true`.
Injected a button on a YouTube page, clicked it with a real input event, and captured the
activation state at call time:

```json
{"outcome":"REJECTED NotAllowedError: Permission denied",
 "act":{"isActive":true,"hasBeenActive":true,"isTrusted":true}}
```

User activation was unambiguously present, so the rejection is Chrome refusing outright —
the API is a stub on macOS. **Conclusion: no in-Chrome route exists. The native helper is
mandatory, not a shortcut.**

---

## Todo

- [x] Scaffold project, log initial prompt to `prompts.txt`
- [x] Verify whether Chrome can do it alone (it cannot — evidence above)
- [x] Probe `NSSharingService` availability
- [x] `helper/airdrop.applescript` — NSSharingService call
- [x] Verify the picker actually appears (screenshot, not exit code)
- [x] `helper/logger.js` — JSON logger to `logs/`
- [x] `helper/validate.js` — URL + token checks, separated for testability
- [x] `helper/server.js` — localhost server, token auth, URL allowlist
- [x] `extension/manifest.json` — MV3, `⌘⇧Y` hotkey
- [x] `extension/background.js` — read playhead, build URL, POST, badge + notify
- [x] `extension/options.html/.js` — token entry + connection test
- [x] `tools/make-icons.js` — dependency-free PNG generator
- [x] `setup.sh` — token, launch agent, instructions
- [x] Unit tests (10 passing)
- [x] Integration tests against the live helper (9 passing)
- [x] End-to-end test: POST → picker on screen (verified by screenshot)
- [x] README, bugfix.md, research.md, FORYOAV.md
- [ ] Load unpacked in Chrome and confirm the hotkey path — **needs Yoav** (Chrome UI)

---

## Review

### What was built
A Chrome MV3 extension plus a local Node helper. The extension reads the `<video>`
playhead, builds a canonical `watch?v=…&t=Ns` URL, and POSTs it to `127.0.0.1:7337`. The
helper validates it and calls AppKit's AirDrop sharing service via `osascript`, which puts
the real macOS picker on screen.

### Design decisions worth remembering
- **AppKit API over UI scripting.** The documented route survives OS updates; clicking
  unlabelled popover buttons does not.
- **The osascript process must stay alive.** `NSSharingService` presents the picker *in the
  calling process*, so the script holds for 120s. Exit immediately and the picker vanishes
  with it. A new send kills the old picker rather than stacking processes.
- **`ProcessType: Interactive`** in the launch agent — a background-throttled agent cannot
  reliably put UI on screen.
- **Validation extracted to its own module** so it could be unit-tested without binding a
  port.

### Known limits (inherent, not defects)
- You always click the recipient. macOS has no preselect API, by design.
- Nearby devices that are not yours appear in the picker.
- The phone must be unlocked and discoverable to show up at all.

### Not done
Loading the unpacked extension in Chrome — that is a Chrome UI action for Yoav. Everything
behind it is tested.
