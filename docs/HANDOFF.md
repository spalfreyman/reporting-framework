# Handoff — commercetools Reporting Framework

Snapshot for picking up in a fresh session. Written 2026-08-21.

/ Also read: `CLAUDE.md` (conventions), `docs/SETUP.md` (running it against the live
project), and the two memory files under
`~/.claude/projects/-Users-spalfreyman-Documents-GitHub-Reporting/memory/`.

---

## What this is

A pluggable ecommerce reporting framework for the commercetools Merchant Center, shipped via
Connect. Reports are declarative JSON definitions; data sources are independently installable
Connect connectors that publish a capability descriptor. The full plan (approved) is at
`~/.claude/plans/i-want-to-build-iridescent-glade.md` — read it for the architecture and the
reasoning behind every constraint.

Not a git repo yet. Node 20 is installed locally but everything targets Node 22.

---

## Build progress (8 milestones, tracked as tasks 1–8)

| # | Milestone | State |
|---|---|---|
| 1 | Repo skeleton + shared contracts | ✅ done |
| 2 | Query gateway + JWT verification | ✅ done |
| 3 | ct-native data-source connector | ✅ done |
| 4 | MC app shell + first live report | ✅ done |
| 5 | Materialization tier (event + job) | ✅ done |
| 6 | ECharts renderer registry + chart tiles | ✅ done |
| 7 | GA4 / warehouse / ERP sample connectors | ✅ done |
| 8 | Full report catalogue + report builder | ✅ done |

**~282 tests pass across 11 packages. All 8 milestones complete.** Run the whole gate with:
```bash
cd /Users/spalfreyman/Documents/GitHub/Reporting && node scripts/fan-out.mjs test
```
Individual checks: `node scripts/check-connect-invariants.mjs`, `check-versions.mjs`,
`validate-reports.mjs`, `sync-shared.mjs --check`. All currently green.

---

## Layout (what exists)

```
Reporting/
├── connect.yaml              # framework connector: 4 apps (app, gateway, event, job)
├── shared/                   # SDK-FREE contracts, copied into every app as src/shared
│   ├── src/schema/           # zod: query protocol, descriptor, chart-spec, report-definition
│   ├── src/semantic/         # 54 metrics, 35 dimensions, formula AST, money, resolve
│   ├── src/planner/          # source selection, join conformance, merge, cache-key, plan
│   ├── src/framing/          # access.ts — server-side role/permission/scope resolution
│   ├── src/rollup/           # keying, cardinality guard, order-mapping (order→fact fold)
│   ├── src/dsp/              # reusable connector HTTP harness + self-registration
│   ├── src/ct/               # ports (SDK-free), lock, keyset pagination
│   ├── src/demo/             # deterministic demo data generator (shared seed)
│   ├── src/catalogue/        # BUILT-IN reports: trading-dashboard, catalogue-health (only 2)
│   └── tests/                # 83 tests
├── shared-node/              # SDK adapters (ct-adapter.ts); copied with --with-node
├── reporting-gateway/        # service: verify JWT → frame → plan → fan-out → merge → cache (46 tests)
├── reporting-rollup-event/   # event: order message → re-fetch → write per-order fact (12 tests)
├── reporting-rollup-job/     # job: keyset scan → facts → fold day partitions → watermark (7 tests)
├── reporting-app/            # MC custom application (28 tests)
│   └── src/components/charts/  # full renderer set (echarts-base, adapters, 11 renderers)
├── connectors/ct-native/     # self-contained connector, own connect.yaml (28 tests)
├── scripts/                  # sync-shared, check-*, fan-out, split-connector, validate-catalogue
├── docs/                     # ARCHITECTURE stubs, SETUP.md, this file
└── sp-demo_claude_for_reporting.env   # live credentials (gitignored)
```

---

## Wired to a live project

Target: commercetools **sp-demo**, region **europe-west1.gcp**, cloud `gcp-eu`. Every app has
a gitignored `.env` generated from the credentials file. The rollup job has been run: **63
real orders** are materialized into the fact store, and the **ct-native descriptor is
registered** in `reporting.datasources/ct-native`. See `docs/SETUP.md` to run each piece.

Live-data quirks already handled (details in the `sp-demo-project` memory):
- **Product Search is NOT activated** → connector probes at startup and omits the 6 live
  catalogue metrics. Catalogue-health report is unavailable on this project by design.
- **5 currencies** across 63 orders → exercises the no-cross-currency-sum rule for real.
- GraphQL order scan: predicate values must be **inlined as quoted literals** (commercetools
  doesn't bind `:placeholders` to GraphQL variables); page size capped at 100 (line-item
  selection blows the 20000 complexity ceiling at 500).

---

## Milestone 6 (ECharts) — DONE

`reporting-app/src/components/charts/`:
- `echarts-base/` — `register-echarts.ts` (explicit `echarts/core` imports; `ensureEchartsRegistered()`),
  `echart.tsx` (~50-line wrapper, no echarts-for-react), `base-option.ts` (grid/tooltip/aria+decal,
  reduced-motion), `theme.ts` (reads UI Kit CSS custom-property tokens with fallbacks),
  `format-value.ts` (routes chart values through the shared `formatCell`).
- `adapters/shape.ts` + `adapters/pivot.ts` — pure ResultSet→chart-shape helpers.
- `renderers/` — kpi-stat, sparkline, data-table (library-free) + time-series, breakdown
  (also exports donut/treemap renderers), funnel, cohort-heatmap, histogram, scatter,
  geo-choropleth, pivot-table (ECharts/UI-Kit).
- Every renderer splits into a **pure `buildOption(...)`** (unit-tested in `charts.spec.ts`,
  15 tests) and a thin component. `registry.ts` lazy-imports each; verified `npm run build`
  keeps ECharts out of the main chunk (it's in a 904K lazy chunk).

Two deliberate stubs to note:
- **Geo map is a placeholder** — `src/assets/geo/world-lite.ts` is rough rectangles for the
  demo countries. Swap for a real boundaries GeoJSON in production; the renderer registers
  whatever that module default-exports and warns on unmatched region codes.
- Jest transforms echarts/zrender via `transformIgnorePatterns` in `jest.test.config.js`
  (they're ESM-only) — chart specs take ~9s because of it.

---

## Milestone 7 (sample connectors) — DONE

Three more self-contained connectors under `connectors/`, each own connect.yaml, all built on
the shared DSP harness + `registerDescriptor`, all with a fixture-backed demo mode from
`shared/src/demo/`:

- **connectors/ga4/** — `ga4-source` (service, 15 tests) + `ga4-prewarm-job` (job, 3 tests).
  Real `@google-analytics/data` live path + demo mode. Per-property token-bucket (`quota.ts`)
  and a Custom Object result cache (`cache.ts`); the prewarm job warms it. Key detail:
  `country` → GA4 `countryId` (ISO code), not `country` (display name). All metrics `sampled`.
- **connectors/warehouse/** — `warehouse-source` (service, 13 tests). Whitelisted parameterised
  SQL only (`sql/manifest.ts` + `compile-query.ts`) — a dimension not on the allowlist is
  rejected before any SQL exists (dedicated injection test). Postgres real; BigQuery/Snowflake
  throw `CAPABILITY_NOT_IMPLEMENTED`. Scale tier: SKU-grain, cost, spend.
- **connectors/erp-oms/** — `erp-oms-source` (service, 13 tests) + `erp-oms-extract-job`
  (job, 2 tests). Built-in fake ERP in `shared/src/demo/fake-erp.ts`. Inventory (point-in-time),
  fulfilment/returns (daily). Live reads come from the extract job's fact objects.

All four sources are REGISTERED in the live sp-demo `reporting.datasources` container. The
cross-source metrics resolve: conversion.rate (ct-native orders ÷ ga4 sessions), margin
(ct-native revenue − warehouse cost), ROAS/CAC (warehouse spend). All demo-mode there (no
GA4/warehouse/ERP creds). Each new connector has a gitignored `.env` sharing the framework's
REPORTING_SHARED_SECRET.

Bug caught while building: ranges are half-open, so `fake…(day, day)` is empty — the ERP
inventory snapshot now uses `(day, day+1)`.

---

## Milestone 8 (catalogue + builder) — DONE

- **Catalogue expanded to 15 built-in reports** (`shared/src/catalogue/`), covering every
  category and every chart type, including the cross-source ones now that ga4/warehouse/erp
  are registered: conversion-funnel, device-geography (choropleth), margin-erosion,
  fulfilment-sla, returns-analysis, stock-cover, cohort-retention (heatmap),
  product-performance (scatter), plus sales-by-channel/category, price-architecture,
  new-vs-returning, promotion-effectiveness. All pass `validate-catalogue.ts`.
- **Validator refined**: a tile forces conformed dimensions only when its metrics share NO
  common domain (a real cross-source join), not merely when a metric *declares* multiple
  domains — so single-source multi-domain metrics (e.g. `shipments.*`) can break down by
  their own non-conformed dims.
- **Report builder** (`reporting-app/src/components/report-builder/`): a working page at
  `/builder`. Metrics/dimensions come from the semantic registry, chart types from the
  renderer registry (only implemented ones). `draft-model.ts` assembles + validates against
  the same zod schema everything uses (12 tests). Live preview via a new gateway endpoint
  `POST /gateway/reports/preview` (runs an unsaved definition through the full framed
  pipeline; requires ManageBuilder). Saves to Custom Object `reporting.reports` via the
  operator's own `manage_key_value_documents` scope (`use-report-definitions`), which the
  gateway already resolves into the catalogue.
- i18n messages added for all new reports/tiles; MC app builds with ECharts still lazy.

---

## Status: all milestones complete

The framework is feature-complete against the plan. ~282 tests across 11 packages, all
green; `check:connect`, `check:versions`, `check:reports`, `check:shared` all pass; the MC
app builds. Four data sources registered in the live sp-demo project (ct-native live;
ga4/warehouse/erp-oms demo).

Sensible next steps if picking up again (all optional / polish, none blocking):
- Deploy to a real Connect account and work the R-items in the risks section
  (`endpoint` on the MC app, `inheritAs`, yarn-vs-npm at build, the event app's injected
  destination env). Nothing here has been through `commercetools connect validate`.
- Row-level store scoping end to end (the seam exists; the JWT carries a stable `sub`).
- Replace the placeholder geo GeoJSON with a real boundaries file.
- `git init` — the repo is still not under version control.
- Broaden report coverage toward the plan's full ~40 (15 shipped) if desired.

## Load-bearing rules — do not break these (tests enforce them)

1. **`shared/` is SDK-free** (it's bundled into the webpack MC app). SDK code → `shared-node/`.
2. **Sync, don't import**: `shared/src` and `shared-node/src` are COPIED into each app's
   `src/shared` / `src/shared-node` by `scripts/sync-shared.mjs` (wired to prebuild/predev/
   pretest). Generated + gitignored — **never edit `<app>/src/shared`**. MC app gets `.js`
   extensions stripped (webpack); Node apps keep them. `--with-node` opts an app into
   shared-node; the MC app is auto-detected and gets bundler imports.
3. **No npm workspaces.** Each app self-contained; root `package.json` is a tooling hub.
4. **connect.yaml at root; every deployed app is a root-sibling folder** named for its
   `deployAs[].name`. `connectors/*` have their OWN connect.yaml and are inert to the root
   deploy; `scripts/split-connector.mjs <name> <target>` materialises one to a standalone repo
   (verified: it builds + tests green standalone).
5. **Money never sums across currencies** — `currency` is an implicit group-by dimension.
6. **Metric ids encode bucketing**: `revenue.net@orderdate` vs `@cashdate`.
7. **Derived metrics are ASTs, evaluated after aggregation**; ratios recomputed from summed
   components; a derived metric with an unavailable leaf is UNAVAILABLE not zero.
8. **Cross-source joins**: FULL OUTER, only on conformed dimensions with matching canonical
   keys; timezone mismatch at day grain refused, not guessed.
9. **Sensitive metrics** (financials) are excluded from `metric:*` wildcard grants; explicit
   deny is absolute.
10. **Cache keys include scopeHash + restatementEpoch.** Rollups: one object per
    (date,cube,shard); keyset-paginate orders, never offset.

---

## Bugs found & fixed so far (so they're not reintroduced)

- Wildcard `metric:*` grant was overriding the deny list → financial metrics leaked. Fixed
  via registry `sensitivity` groups excluded from wildcards.
- A tile with only a derived metric whose leaf was unservable reported `ok` while showing
  nulls. Derived-with-missing-leaf now counts as unavailable.
- Unauthenticated gateway requests returned 500 (with stack) instead of 401. All verifier
  throws now map to 401; 4xx logged at warn without stacks.
- MC app resolved a different transitive `zod` from an ancestor node_modules → pinned zod
  explicitly.
- Lint was scanning generated `src/shared` (9,280 noise findings) → ignored in eslint config.
- GraphQL keyset predicate: inline quoted literals, not GraphQL variables.

---

## Open risks to verify before/while continuing (from the plan)

- ECharts 6 subpath exports unchanged from 5.x (M6).
- MC shell's dark-mode toggle mechanism (class vs data-attr vs media query) (M6 theming).
- Connect deploy specifics never exercised here (no Connect account): `endpoint` on the MC
  app (docs say omit, Data_checker precedent sets `/`), `inheritAs` with an MC app present,
  yarn-vs-npm at build time, the event app's injected destination env var names. Settle with
  `commercetools connect validate` when a Connect account is available.
- Row-level store scoping: the exchange JWT DOES carry a stable `sub` (confirmed by reading
  the verifier source), so the assignment-based design is viable — the seam exists in
  `shared/src/framing/access.ts` (`ScopeAssignment`) but the gateway currently ships
  report-level + field-level framing; wire the assignment lookup when building that out.

---

## Handy commands

```bash
cd /Users/spalfreyman/Documents/GitHub/Reporting
node scripts/fan-out.mjs test          # whole test gate (~204)
node scripts/fan-out.mjs typecheck
node scripts/sync-shared.mjs --all     # re-copy shared into every app
node scripts/check-connect-invariants.mjs
# run one app locally (reads its .env):
cd reporting-rollup-job && npm run build && set -a && . ./.env && set +a && node dist/src/index.js
```


## Live demo data (added 2026-08-21)

`tools/event-generator/` seeds REAL test orders into sp-demo via the Order Import API
(marked `SIM-`, removable with `npm run cleanup`). 366 orders across 90 days are already
seeded and folded; the trading reports show real shape, currency-split, with store/channel
breakdowns. Historical dates use `completedAt` (createdAt is server-assigned) and the rollup
prefers completedAt for bucketing.

GA4: the connector (connectors/ga4) is built and works in demo mode. The generator can send
matching GA4 Measurement Protocol events (src/ga4.ts), gated on GA4_MEASUREMENT_ID +
GA4_API_SECRET. MP only accepts events <72h old, so GA4 fills via the live loop, not the
historical seed. To go live: provide the GA4 property id + MP secret + Data API
service-account and flip connectors/ga4 MODE=live (see tools/event-generator/README.md).
Storefront (clickable) is the remaining deferred piece.
