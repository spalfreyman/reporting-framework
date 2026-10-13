#!/bin/sh
# Daily weekday faker.
#
# Generates a day of realistic test orders in varied states (completed / ordered / canceled /
# refunded / abandoned, of varying sizes) plus matching GA4 funnels, then folds them into the
# reporting fact store. Driven by the launchd agent `com.commercetools.reporting.faker`
# (see scripts/install-daily-faker.sh), but safe to run by hand too:
#
#   sh tools/event-generator/scripts/daily-faker.sh
#
# Self-locating: resolves the repo layout from its own path, so it does not care where it is
# invoked from. All output is appended to tools/event-generator/daily-faker.log.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"      # tools/event-generator/scripts
GEN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # tools/event-generator
ROOT_DIR="$(cd "$GEN_DIR/../.." && pwd)"         # repo root
JOB_DIR="$ROOT_DIR/reporting-rollup-job"
LOG="$GEN_DIR/daily-faker.log"
PORT_DEFAULT=8083

ts()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"; }

say "=== daily faker run start ==="

# 1) Generate the day's orders + GA4 funnels. `npm run loop` routes through with-ca.sh so a
#    corporate TLS-intercepting proxy (corp-ca.pem) does not break the GA4 sends.
cd "$GEN_DIR"
if GEN_LOOP_ORDERS="${GEN_LOOP_ORDERS:-5}" \
   GEN_LOOP_MAX_TICKS="${GEN_LOOP_MAX_TICKS:-12}" \
   GEN_LOOP_INTERVAL_MS="${GEN_LOOP_INTERVAL_MS:-2000}" \
   npm run --silent loop >> "$LOG" 2>&1; then
  say "generator ok"
else
  say "generator FAILED — skipping fold"; exit 1
fi

# 2) Fold into the day-partitioned fact store. The deployed reporting-rollup-event subscription
#    writes a per-order fact at import time using the *currently deployed* mapping; FORCE_REWRITE
#    makes this local fold restate those cells with the current shape (paymentState + refunds).
#    SAFE_LAG_SECONDS=0 because imported orders are already settled.
cd "$JOB_DIR"
set -a; . ./.env; set +a
PORT="${PORT:-$PORT_DEFAULT}"

if [ ! -f dist/src/index.js ]; then
  say "building rollup-job (no dist)"; npm run --silent build >> "$LOG" 2>&1 || { say "job build FAILED"; exit 1; }
fi

# A listener left behind by a previous run would make us POST to a stale build — clear it.
lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

ROLLUP_SAFE_LAG_SECONDS=0 ROLLUP_FORCE_REWRITE=true nohup node dist/src/index.js >> "$LOG" 2>&1 &
JOB_PID=$!

# Wait for the HTTP server to accept connections (any response — even 404 — means it is up).
i=0; while [ "$i" -lt 20 ]; do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then break; fi
  i=$((i + 1)); sleep 1
done

if curl -s -X POST "http://localhost:$PORT/rollup-job" -H 'content-type: application/json' \
     -d '{}' --max-time 280 >> "$LOG" 2>&1; then
  printf '\n' >> "$LOG"; say "fold ok"
else
  say "fold POST FAILED"
fi

kill "$JOB_PID" 2>/dev/null || true
lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

say "=== daily faker run done ==="
