#!/bin/bash
# Fires one real send at the helper. An AirDrop picker WILL appear on screen.
# Usage: tests/manual/send-test.sh [youtube-url]
set -euo pipefail

URL="${1:-https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=213s}"
TOKEN_FILE="$HOME/.youtube-airdrop-token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "error: no token at $TOKEN_FILE — run ./setup.sh first" >&2
  exit 1
fi

echo "Health:"
curl -fsS http://127.0.0.1:7337/health && echo

echo "Sending: $URL"
curl -fsS -X POST http://127.0.0.1:7337/airdrop \
  -H 'Content-Type: application/json' \
  -H "X-Token: $(cat "$TOKEN_FILE")" \
  -H 'Origin: chrome-extension://manualtest' \
  -d "{\"url\":\"$URL\"}"
echo
echo "Picker should be on screen. Close it with: pkill -f airdrop.applescript"
