#!/bin/bash
# One-time setup: mint the shared token and install the helper as a login agent.
# Safe to re-run; it reuses an existing token rather than rotating it.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN_FILE="$HOME/.youtube-airdrop-token"
LABEL="com.youdrop.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node || true)"

if [ -z "$NODE_BIN" ]; then
  echo "error: node not found on PATH. Install Node 18+ and re-run." >&2
  exit 1
fi

if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 32 > "$TOKEN_FILE"
  echo "Created token at $TOKEN_FILE"
else
  echo "Reusing existing token at $TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

mkdir -p "$HOME/Library/LaunchAgents" "$REPO_DIR/logs"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_DIR/helper/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$REPO_DIR/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO_DIR/logs/launchd.err.log</string>
</dict>
</plist>
PLIST_EOF

echo "Wrote $PLIST"

# ProcessType Interactive matters: the helper has to be able to put the AirDrop
# picker on screen, which a background-throttled agent cannot do reliably.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 1

if curl -fsS "http://127.0.0.1:7337/health" >/dev/null 2>&1; then
  echo "Helper is running and healthy."
else
  echo "warning: helper did not answer /health yet. Check $REPO_DIR/logs/" >&2
fi

cat <<INSTRUCTIONS

------------------------------------------------------------------
Next steps in Chrome
------------------------------------------------------------------
1. Open  chrome://extensions
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and choose:
     $REPO_DIR/extension
4. Open the extension's Options and paste this token:

$(cat "$TOKEN_FILE")

5. Optional: set the hotkey at chrome://extensions/shortcuts
   (it asks for Command+Shift+Y by default)

Then: play a YouTube video, press Command+Shift+Y, and pick your
phone in the AirDrop window that appears.
------------------------------------------------------------------
INSTRUCTIONS
