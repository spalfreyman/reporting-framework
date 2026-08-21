# Local setup

The framework is wired to a real commercetools project for local development. Credentials
were provided in `sp-demo_claude_for_reporting.env` (gitignored) and each app has a generated,
gitignored `.env`. Nothing secret is committed; `.env.example` documents the contract.

Target project: **sp-demo**, region **europe-west1.gcp** (cloud `gcp-eu`).

## What is already set up

- Every backend app and the ct-native connector have a `.env` pointing at sp-demo, sharing
  one `REPORTING_SHARED_SECRET` between the gateway and the connector (they must match).
- The rollup job has been run once: 63 orders backfilled into day-partitioned fact objects,
  plus a `reporting.config/rollup-watermark`.
- The ct-native connector's capability descriptor is registered in
  `reporting.datasources/ct-native`, so the gateway discovers it. Because Product Search is
  not activated on this project, the descriptor advertises the 19 order metrics only.

## Run the pieces

Each command reads that app's `.env`.

```bash
# 1. Materialize / refresh order rollups (safe to re-run; idempotent).
cd reporting-rollup-job && npm run build && set -a && . ./.env && set +a && node dist/src/index.js

# 2. The commercetools data-source connector (serves order metrics from the rollup).
cd connectors/ct-native/ct-native-source && npm run build && set -a && . ./.env && set +a && node dist/src/index.js
#    Probe it:
#    curl -s localhost:8081/ct-native-source/health

# 3. The query gateway. It needs an HTTPS tunnel for the Merchant Center to reach it,
#    because /proxy/forward-to will not call plain http://localhost.
cd reporting-gateway && npm run build && set -a && . ./.env && set +a && node dist/src/index.js
#    In another shell:  cloudflared tunnel --url http://localhost:8080
#    then set MC_SESSION_AUDIENCE / the app's REPORTING_GATEWAY_URL to the tunnel origin.

# 4. The Merchant Center app (dev server on :3001).
cd reporting-app && npm start
```

## Known limitations on sp-demo

- **Product Search is not activated**, so the live "Catalogue health" report is unavailable
  here — the connector correctly reports this rather than erroring. Activate Product Search
  on the project to enable it.
- Most orders have no store or sales channel, so those breakdowns show `_none`.
- The end-to-end MC → gateway path needs a real Merchant Center login (the exchange JWT is
  minted by the MC API gateway), so it cannot be exercised from a plain terminal; each layer
  is verified independently against the real data.

## The whole test gate

```bash
node scripts/fan-out.mjs test    # ~204 tests across all packages
```
