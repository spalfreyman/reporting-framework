#!/bin/sh
# Removes the daily weekday faker launchd agent.
set -eu
LABEL="com.commercetools.reporting.faker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL (and $PLIST). The generator code and .env are untouched."
