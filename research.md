# Research notes

## Chrome's `navigator.share` is a stub on macOS (measured 2026-09-17, Chrome 153)

Public sources contradict each other on whether Chrome desktop supports the Web Share API
on macOS. MDN-adjacent summaries claim Windows/macOS/Linux support; the MDN
browser-compat-data tracker has an open issue saying it is not properly supported on macOS.

Measured directly, which settles it. On a YouTube page in Chrome 153 / macOS 15.7.1:

```js
typeof navigator.share            // "function"
typeof navigator.canShare         // "function"
navigator.canShare({url: href})   // true
```

All three say "supported". They are wrong. A real click on an injected button, with the
activation state captured inside the handler:

```json
{"outcome":"REJECTED NotAllowedError: Permission denied",
 "act":{"isActive":true,"hasBeenActive":true,"isTrusted":true}}
```

`isActive: true` and `isTrusted: true` rule out the usual explanation (missing transient
activation). Chrome exposes the API surface, has `canShare` return `true`, and then refuses
the call. Chrome implements it for real on Android, Windows and ChromeOS.

**Takeaway:** feature-detecting `navigator.share` — even via `canShare()` — is not enough
on desktop. The only reliable check is to call it and handle the rejection.

## The macOS share popover is not accessibility-labelled

Safari's `File ▸ Share…` is a single menu item that opens a popover. Enumerated on macOS
15.7.1, its 13 destination rows are `AXButton`s with `name`, `description`, `help`,
`title` and `value` all `missing value`, and no children — nothing but coordinates.

Any "script the Share menu" recipe therefore reduces to clicking a hard-coded index. Use
`NSSharingService` instead.

## `NSSharingService` AirDrop: items must be `NSURL`, and the host process must live

```applescript
use framework "AppKit"
set svc to current application's NSSharingService's ¬
  sharingServiceNamed:(current application's NSSharingServiceNameSendViaAirDrop)
```

Two non-obvious constraints, both measured:

1. `canPerformWithItems:` returns **`true` for an `NSURL`** and **`false` for an
   `NSString`** holding the same text. Wrap the string in `NSURL's URLWithString:`.
2. The picker is presented **by the calling process**. `osascript` that returns immediately
   takes the picker down with it, so the script must block while the picker is up.

There is no API to preselect an AirDrop recipient. That is intentional on Apple's part, so
"fully automatic AirDrop with no click" is not achievable through any supported route.

## Sources

- [MDN — Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)
- [mdn/browser-compat-data issue #18340 — navigator.share not fully supported on Chrome/Opera macOS](https://github.com/mdn/browser-compat-data/issues/18340)
- [canalnoises/AirDrop-Shortcut — the Finder Share-menu UI-scripting approach this project rejected](https://github.com/canalnoises/AirDrop-Shortcut)
