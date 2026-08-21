# commercetools Reporting Framework

A pluggable ecommerce reporting framework for the commercetools Merchant Center, deployed
via Connect.

- **Reports are data, not code.** A report is a declarative JSON definition — metrics,
  dimensions, filters, layout and a library-agnostic chart spec — so reports can be added
  and reframed without shipping a release.
- **Data sources are pluggable.** Each downstream system (commercetools, Google Analytics 4,
  an ERP/OMS, a warehouse) is an independently installable Connect connector that publishes
  a capability descriptor. Install one and the framework discovers it; no framework redeploy.
- **Framed by role and availability.** What a user sees is decided server-side from their
  verified Merchant Center permissions and the sources actually installed.

## Repository shape

| Path | What it is |
|---|---|
| `connect.yaml` | The framework connector: MC app, query gateway, rollup event handler, rollup job |
| `shared/` | Framework contracts — schemas, semantic registry, planner, framing, rollup keying |
| `reporting-app/` | Merchant Center custom application |
| `reporting-gateway/` | Connect `service` — authorises, plans, fans out, merges, caches |
| `reporting-rollup-event/` | Connect `event` — writes per-order facts from Subscriptions |
| `reporting-rollup-job/` | Connect `job` — folds facts into day partitions, reconciles, backfills |
| `connectors/` | Sample data-source connectors, each self-contained with its own `connect.yaml` |
| `docs/` | Architecture, the query protocol, the report catalogue |

See [CLAUDE.md](./CLAUDE.md) for the conventions and the platform constraints that drive them.

## Status

Under construction. `shared/` is complete and tested (72 tests); the apps and connectors
are being built in the order described in `docs/architecture.md`.

## Picking this up

Mid-build. Start from [docs/HANDOFF.md](docs/HANDOFF.md) — it has current state, what's next, and the rules that must not be broken.
