#!/bin/sh
# Installs (or reinstalls) the launchd agent that runs daily-faker.sh every weekday.
#
#   sh tools/event-generator/scripts/install-daily-faker.sh          # default 09:00 local
#   FAKER_HOUR=7 FAKER_MINUTE=30 sh .../install-daily-faker.sh        # custom time
#
# Writes ~/Library/LaunchAgents/com.commercetools.reporting.faker.plist and loads it. The agent
# fires Mon–Fri at the chosen local time; it only runs while you are logged in and the Mac is
# awake (that is launchd, not this script). Remove it with uninstall-daily-faker.sh.
set -eu

LABEL="com.commercetools.reporting.faker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GEN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/daily-faker.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOUR="${FAKER_HOUR:-9}"
MINUTE="${FAKER_MINUTE:-0}"
NODE_BIN="$(dirname "$(command -v node)")"

mkdir -p "$HOME/Library/LaunchAgents"

# One <dict> per weekday (launchd: 1=Mon … 5=Fri).
cal=""
for day in 1 2 3 4 5; do
  cal="$cal
    <dict><key>Weekday</key><integer>$day</integer><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>"
done

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$RUNNER</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>$cal
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$GEN_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$GEN_DIR/launchd.err.log</string>
</dict>
</plist>
PLIST

# Reload cleanly whether or not a previous version is loaded.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "Installed $LABEL — runs weekdays at $(printf '%02d:%02d' "$HOUR" "$MINUTE") local."
echo "  plist:   $PLIST"
echo "  runner:  $RUNNER"
echo "  node:    $NODE_BIN"
echo "  logs:    $GEN_DIR/daily-faker.log (run detail), launchd.{out,err}.log (agent)"
echo "Run once now to verify:  sh $RUNNER"
echo "Remove it:               sh $SCRIPT_DIR/uninstall-daily-faker.sh"
