#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.cc-tg-hub.broker.plist"
STATE_DIR="$HOME/.claude/cc-tg-hub"

mkdir -p -m 700 "$STATE_DIR" "$STATE_DIR/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cc-tg-hub.broker</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v bun)</string>
    <string>--cwd</string>
    <string>$REPO/broker</string>
    <string>src/index.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$STATE_DIR/logs/broker.out.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/logs/broker.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed and started: $PLIST"
echo "Logs: $STATE_DIR/logs/broker.err.log"