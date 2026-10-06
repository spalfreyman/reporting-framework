# Sample Data Source (`sample`)

Reporting data source for Sample Data Source. Generated from the data-source-connector template; serves synthetic data until a real upstream is wired in.

A self-contained reporting **data-source connector** for the commercetools Reporting
Framework. Two apps:

- **`sample-source`** (`service`) — answers the three DSP endpoints (`/health`,
  `/describe`, `/query`) at `/sample-source`. It declares its capabilities in
  `src/descriptor.ts` and serves rows from `src/data.ts`.
- **`sample-prewarm-job`** (`job`) — a scheduled long-running HTTP server that
  resolves the source URL from its registered descriptor and calls `/query` to warm/extract.

## How discovery works

On deploy, `sample-source`'s `postDeploy` upserts its descriptor into Custom Object
`reporting.datasources/<SOURCE_ID>`. The gateway lists that container to learn what exists —
so installing this connector extends the framework with **no framework redeploy**, and
uninstalling it degrades affected reports rather than breaking them.

## Make it a real connector

1. **`src/descriptor.ts`** — declare the metric ids, dimensions and grains you actually
   serve. Map to the shared semantic metric ids (e.g. `sessions.count`) so your figures
   conform and can join across sources. The DSP harness rejects any request for something you
   did not declare, so keep this honest.
2. **`src/data.ts`** — replace `generateRows()` with real upstream calls (HTTP API, warehouse
   query, live commercetools facet). Return the same tidy-long `{ columns, rows }` shape.
3. **`src/env.ts`** / **`connect.yaml`** — add the config/secrets your upstream needs.
4. **`sample-prewarm-job/src/prewarm.ts`** — set the windows/combinations to warm, or
   replace with extract-and-store logic.

## Local build & test

```bash
cd sample-source && npm install && npm run build   # prebuild vendors shared/ automatically
cd ../sample-prewarm-job && npm install && npm run build
```

## Deploy

`connect.yaml` lives at this connector's root. Materialise it into a standalone repo for a
real Connect deployment:

```bash
node scripts/split-connector.mjs sample ../reporting-source-sample
```

Then create/publish/install it from the Merchant Center (Organization settings → Connect).
`REPORTING_SHARED_SECRET` must equal the framework gateway's, and `SOURCE_TIMEZONE` must match
the framework's `ROLLUP_TIMEZONE`.
