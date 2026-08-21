# commercetools Reporting Framework — conventions

A pluggable reporting framework for the Merchant Center, shipped via commercetools Connect.
Reports are declarative definitions; data sources are independently installable connectors.

## Layout rules (non-negotiable — Connect enforces them)

- `connect.yaml` lives at the **repo root**. Every deployed app is a **root-sibling folder**
  whose name matches its `deployAs[].name` (charset `[A-Za-z0-9_-]`, no slashes).
- **No npm workspaces.** Connect runs `install` inside each app folder independently. The
  root `package.json` is a tooling hub only.
- `shared/src` is **copied** into each app as `src/shared` by `scripts/sync-shared.mjs`
  (wired to `prebuild`/`predev`/`pretest`). It cannot be a relative import: `mc-scripts`'
  babel-loader `include` and each Node app's tsconfig `rootDir` both reject files above the
  app root. The copy is gitignored; `.shared-hash` makes staleness detectable.
- `connectors/*` each hold a **complete self-contained connector** with their own
  `connect.yaml`. They are inert to the framework's deploy. `scripts/split-connector.mjs`
  materialises one into a standalone repo for real deployment.

Run `yarn check:connect` to verify all of the above.

## The constraint that shapes the architecture

commercetools has **no aggregation API for orders**. Order Search indexes only 3 months,
returns IDs only, and does no aggregation; standard queries cap at 500/page and 10,000
offset. So order-grain metrics must be **materialized**. Product Search *does* support
`count`/`ranges`/`stats` facets, so catalogue, price and inventory reporting can be **live**.

Consequences that are easy to undo by accident:
- **Never use `offset`** to walk orders. Keyset-paginate on `(lastModifiedAt, id)`.
- **Never use Order Search for backfill** — the 3-month floor makes it useless for history.
- The rollup writes **one object per (date, cube, shard)** holding a rows array, not one
  object per fact row. That is three orders of magnitude in object count.

## Correctness rules encoded in the code

These are all covered by tests in `shared/tests` — if you change the behaviour, the tests
should fail. Do not "fix" them by relaxing the assertion.

- Money is never a bare number. `currency` is an implicit mandatory dimension of every
  money metric, so "you cannot sum across currencies" is true by construction.
- Metric ids encode their bucketing rule: `revenue.net@orderdate` vs `@cashdate`.
- Derived metrics are ASTs, evaluated **after** aggregation. Ratio of sums, never sum of
  ratios. Totals recompute ratios from summed components rather than averaging a column.
- Cross-source joins are **FULL OUTER** and only on conformed dimensions with matching
  canonical keys. Timezone mismatch at day grain is refused, not guessed.
- The fan-out guard refuses to aggregate a non-additive metric rather than inflating it.
- Sensitive metrics (`sensitivity: 'financials'`) are **not** covered by a `metric:*`
  wildcard grant. An explicit deny is absolute.
- Cache keys include `scopeHash` and `restatementEpoch`. Omitting scope leaks one
  subject's cached tile to another.
- Ranges are half-open `[from, to)`.

## Stack

- Backend apps: `@commercetools/platform-sdk@^9` + `@commercetools/ts-client@^5` (never the
  legacy `sdk-client-v2`), `@commercetools-backend/express` for the MC session middleware.
- MC app: `@commercetools-frontend/*` all on the **same** version, `@commercetools-uikit/*`,
  React 19, TypeScript 5.9.2. Charts: `echarts@^6` (Apache-2.0) behind a renderer registry.
- Node 22, yarn. `yarn check:versions` enforces the lockstep rule.

## Commands

```bash
yarn check:connect     # Connect layout invariants
yarn check:versions    # @commercetools-frontend/* lockstep + no legacy SDK
yarn check:reports     # built-in reports validate against schema + registry
yarn sync:shared       # copy shared/src into every app
cd shared && npm test  # typecheck + 72 unit tests + catalogue validation
```
