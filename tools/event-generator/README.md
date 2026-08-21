# Event generator

A dev tool that creates **real test orders** (and optionally matching **GA4 events**) in a
commercetools project, so the reporting framework has activity to render. It is not a
Connect app and is never deployed.

Every order it creates is marked with a `SIM-` order number so the whole set is
identifiable and removable.

## Setup

```bash
cd tools/event-generator
cp ../../sp-demo_claude_for_reporting.env .env   # or your own project's credentials
npm install
```

The tool's `.env` is **authoritative for `CTP_*`** and overrides any ambient shell values —
deliberately, because it WRITES orders and must never target the wrong project by inheriting
the machine's global settings.

## Orders

```bash
npm run seed       # backfill GEN_DAYS (default 90) days of seasonality-shaped orders
npm run loop       # then trickle GEN_LOOP_ORDERS new orders every GEN_LOOP_INTERVAL_MS
npm run cleanup    # delete every SIM- order
```

Historical dates are real: `completedAt` is set on each imported order (commercetools will
not let `createdAt` be backdated), and the rollup buckets on it. Tuning: `GEN_DAYS`,
`GEN_ORDERS_PER_DAY`, `GEN_SEED`, `GEN_CONCURRENCY`, `GEN_LOOP_INTERVAL_MS`, `GEN_LOOP_ORDERS`.

After seeding, fold the orders into the reports:

```bash
cd ../../reporting-rollup-job && npm run build
ROLLUP_SAFE_LAG_SECONDS=0 node dist/src/index.js   # lag 0: imported data is already settled
```

(`ROLLUP_SAFE_LAG_SECONDS=0` is only for a one-off backfill. The scheduled job keeps the
default 120s guard so it never reads a write that is still settling.)

## GA4 (real property)

The generator can send a matching web-analytics journey per order — `session_start`,
`view_item`, `add_to_cart`, `begin_checkout`, `purchase` — to a **real GA4 property** via the
Measurement Protocol, so the funnel/acquisition reports fill from the same activity as the
orders and reconcile.

Add to `.env`:

```
GA4_MEASUREMENT_ID=G-XXXXXXXXXX     # Admin → Data streams → your web stream
GA4_API_SECRET=xxxxxxxx            # Admin → Data streams → Measurement Protocol API secrets
# GA4_MP_DEBUG=true                # validate event shape without ingesting
```

Then `npm run loop` sends events for each live order. **Constraint:** the Measurement
Protocol only accepts events < 72 hours old, so historical seed days cannot be backfilled
into GA4 this way — run the loop to accumulate GA4 data over time. The tool logs how many
events it skipped for being too old.

To make the **GA4 connector read that data**, set on `connectors/ga4/ga4-source/.env`:

```
MODE=live
GA4_PROPERTY_ID=123456789          # Admin → Property Settings → Property ID (numeric)
GA4_SERVICE_ACCOUNT_JSON={...}     # a service account with Viewer on the property (single line)
```

then re-run its `postDeploy` so the descriptor registers, and the gateway will serve GA4
metrics. Note: GA4 standard reporting has processing latency (minutes to ~24–48h); the
figures are modelled/measured and the connector marks them `estimated`, never treating them
as the revenue truth (commercetools remains that).

Device category is approximate over the Measurement Protocol (GA4 normally derives it from a
browser user agent, which server events lack).
