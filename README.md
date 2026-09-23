<div align="center">

<img src="assets/logo.png" alt="YouDrop: a cow dropping YouTube videos" width="210">

# YouDrop

**AirDrop the YouTube moment you're watching — straight from Chrome to your phone.**

Pause on the frame you care about, press `⌘⇧Y`, tap your phone.
The YouTube app opens at *that second*.

![platform](https://img.shields.io/badge/platform-macOS-black)
![chrome](https://img.shields.io/badge/Chrome-MV3-4285F4)
![node](https://img.shields.io/badge/node-%E2%89%A518-5FA04E)
![deps](https://img.shields.io/badge/dependencies-none-brightgreen)

</div>

---

## What it does

You're halfway through a 40-minute talk at your desk and you have to leave — commute,
gym, walk, school run. You want the rest of it on your phone, resuming exactly where you
stopped, not from the beginning.

Today that means copying the URL, hunting for "copy link at current time", pasting it into
a message to yourself, and finding it again on the phone.

With YouDrop: `⌘⇧Y` → tap your phone → it's waiting for you, at the right second.

```
          Chrome (any YouTube page)
                    │
              ⌘⇧Y   │  watch?v=…&t=1122s
                    ▼
          AirDrop picker on your Mac
                    │  ← your click
                    ▼
                 iPhone
                    │  ← tap Accept
                    ▼
       YouTube app, playing at 18:42
```

---

## Why this needs a helper process (the interesting part)

The obvious version of this extension is impossible, and it's worth knowing why before you
install anything.

**AirDrop is unreachable from a browser.** It's an AppKit feature wired into a daemon
(`sharingd`), and a Chrome extension runs in a sandbox built specifically to prevent that
kind of reach. No extension API exposes the macOS share sheet.

**The Web Share API looks like an escape hatch. It isn't.** On macOS, Chrome ships the API
*surface* with nothing behind it:

```js
typeof navigator.share          // "function"   ← exists
navigator.canShare({ url })     // true         ← claims it'll work
await navigator.share({ url })  // ✗ NotAllowedError: Permission denied
```

That rejection normally means "no user gesture", so it's easy to misdiagnose. It isn't
that — measured inside a real click handler, with `isTrusted: true` and
`navigator.userActivation.isActive: true`, it still refuses. Chrome implements Web Share
properly on Android, Windows and ChromeOS; on macOS it's a stub.

So the share has to happen in native code. YouDrop runs a ~200-line Node process on
loopback that calls AppKit's documented sharing API.

**Why not script Safari's Share menu, like every other AirDrop automation?** Because that
menu is a trap. `File ▸ Share…` opens a popover whose 13 destinations are `AXButton`s with
**no name, no help text, no value, no children** — nothing but screen coordinates:

```
1. AXButton | name=missing value | pos=612,180
2. AXButton | name=missing value | pos=612,202
… 13 of these
```

"Click AirDrop" would mean clicking index 1 and praying across every macOS update.
`NSSharingService(named: .sendViaAirDrop)` is public API, needs no Accessibility
permission, and doesn't care how Apple reorders a popover.

---

## Requirements

| | |
|---|---|
| **macOS** | Any version with AirDrop (built and tested on 15.7.1) |
| **Node** | 18 or newer — `node --version` |
| **Chrome** | Any current version |
| **Your phone** | Unlocked, AirDrop set to Contacts Only or Everyone |

No npm dependencies. Nothing to `npm install`.

---

## Installation

### 1. Clone and run setup

```bash
git clone https://github.com/yoavxyoav/youdrop.git
cd youdrop
./setup.sh
```

`setup.sh` is idempotent — safe to re-run. It:

- mints a 256-bit token at `~/.youtube-airdrop-token` (mode `600`)
- installs a launch agent at `~/Library/LaunchAgents/com.youdrop.helper.plist`
- starts the helper on `127.0.0.1:7337` and confirms it's healthy
- prints your token and the next steps

The helper starts automatically at login from then on. You never start it by hand.

### 2. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `extension/` folder
4. Click the puzzle-piece icon in the toolbar and **pin** YouDrop

### 3. Pair them

1. Copy your token: `cat ~/.youtube-airdrop-token`
2. On `chrome://extensions`, click **Details** → **Extension options**
3. Paste the token → **Save** → **Test connection**

You want: *"Helper is running and the token works."*

### 4. Check the hotkey

Chrome doesn't always bind suggested shortcuts for unpacked extensions. Visit
`chrome://extensions/shortcuts` and confirm `⌘⇧Y` is assigned. The toolbar icon works
either way.

---

## Usage

1. Play any YouTube video. Pause where you want.
2. Press **`⌘⇧Y`** (or click the toolbar icon).
3. The macOS AirDrop picker appears — **click your phone**.
4. Tap **Accept** on the phone.

A Chrome notification confirms what was sent, with the timestamp:

> **AirDrop picker open**
> Rick Astley - Never Gonna Give You Up @ 2:15 — pick your phone on screen.

Works on `/watch`, `/shorts`, `/live`, `/embed` and `youtu.be`. Live streams are sent
without a timestamp — there's no meaningful offset to resume from.

---

## Two things that are not bugs

**You always click the recipient yourself.** macOS has no API to preselect an AirDrop
target. That's deliberate: without the mandatory human click, any process on your Mac
could silently fling files at any device in Bluetooth range. The picker is as automated as
this can get, and that limit is load-bearing.

**Other people's devices appear in the picker.** AirDrop discovers whatever is nearby and
visible — a colleague's Mac can show up next to your phone. Read the names before clicking.

---

## Troubleshooting

<details>
<summary><b>My phone isn't in the picker</b></summary>

Unlock it → Control Centre → AirDrop → **Contacts Only** or **Everyone**. The picker
discovers devices live each time; it doesn't remember them between sends.
</details>

<details>
<summary><b>"Helper not reachable"</b></summary>

```bash
npm run health                       # expect {"ok":true,...}
launchctl kickstart -k "gui/$(id -u)/com.youdrop.helper"
npm run logs                         # tail today's JSON log
```
</details>

<details>
<summary><b>"Helper rejected the token"</b></summary>

Re-copy it and paste it again in the extension options — it's easy to miss a character:

```bash
cat ~/.youtube-airdrop-token
```
</details>

<details>
<summary><b>⌘⇧Y does nothing</b></summary>

Chrome didn't bind the shortcut. Assign it at `chrome://extensions/shortcuts`.
</details>

<details>
<summary><b>The link opens at 0:00 instead of the timestamp</b></summary>

Reload the extension at `chrome://extensions` (the ⟳ icon) — a stale service worker is the
usual cause. If it persists, open the service worker console from that page and check what
`readPlaybackState` returns.
</details>

<details>
<summary><b>The picker vanishes when I click someone</b></summary>

That was a real bug, fixed: the helper now pumps an `NSRunLoop` while the picker is up
instead of blocking on `delay`. Make sure you're on the current version.
</details>

---

## How it's put together

```
extension/                 Chrome MV3 extension
  manifest.json            permissions, ⌘⇧Y hotkey, icons
  background.js            reads the playhead, builds the URL, POSTs to the helper
  options.html / .js       token entry + connection test
  icons/                   generated PNGs — no binary assets checked in by hand
helper/
  server.js                loopback HTTP server, token auth, URL allowlist
  validate.js              URL + token checks, split out so they're unit-testable
  airdrop.applescript      NSSharingService call + run loop
  logger.js                JSON logger → logs/
tests/
  unit/                    validation logic, no network
  integration/             live helper API — never opens a picker
  manual/send-test.sh      one real send (opens a picker)
tools/make-icons.js        dependency-free PNG generator
setup.sh                   token + launch agent install
```

Two implementation details that aren't obvious and will bite anyone modifying this:

1. **The AirDrop item must be an `NSURL`.** `canPerformWithItems:` returns `false` for an
   `NSString` holding the same text.
2. **The picker is presented by the calling process**, so `osascript` must stay alive *and
   keep pumping its run loop*. A plain `delay` blocks the main thread: the picker draws,
   but your click can never be dispatched and the window vanishes on contact.

---

## Development

```bash
npm test                   # unit tests
npm run test:integration   # integration tests (helper must be running)
npm run health             # curl the health endpoint
npm run logs               # tail today's JSON log
npm run icons              # regenerate icons
npm start                  # run the helper in the foreground

tests/manual/send-test.sh  # one real send — opens a picker
```

After changing anything in `helper/`, restart the agent:

```bash
launchctl kickstart -k "gui/$(id -u)/com.youdrop.helper"
```

After changing anything in `extension/`, hit the ⟳ icon on `chrome://extensions`.

---

## Security

The helper is a local process that can put a native share picker on screen, so it's
deliberately locked down:

- Binds `127.0.0.1` only, and re-checks the peer address on every request
- Requires a 256-bit token in `X-Token`, compared without early exit
- Requires a `chrome-extension://` `Origin` when one is present — a random web page can
  technically issue the POST, but it can't pass this
- Accepts **https YouTube hosts only**, by exact hostname match; `youtube.com.evil.test`
  is rejected, as are `file:`, `javascript:` and `data:` URLs
- Caps request bodies at 4 KB, and answers with a real `413` rather than dropping the socket
- Replaces its own previous picker instead of stacking processes

Worst case if the token leaks to something already running on your Mac: that thing can make
an AirDrop picker appear with a YouTube link in it. It still can't send anything without
your click.

---

## Uninstall

```bash
launchctl bootout "gui/$(id -u)/com.youdrop.helper"
rm ~/Library/LaunchAgents/com.youdrop.helper.plist
rm ~/.youtube-airdrop-token
```

Then remove the extension from `chrome://extensions`.
