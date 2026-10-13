# Connect SCA exception request — `reporter` connector, `reporting-app`

**Requested by:** Sam Palfreyman (sam.palfreyman@commercetools.com)
**Date:** 2026-10-07

## Summary

Publishing the private-use Connect connector **`reporter`** fails at pipeline **step 4
(software-composition analysis)**. After remediation work (below), the findings are now confined
to a **single application** — the Merchant Center custom application `reporting-app` — and every
remaining flagged package is a **build-time dependency of the official, version-locked
`@commercetools-frontend` toolchain**. None of them ship in the deployed artifact.

We are requesting an SCA exception so this connector can be published for private use.

## Identifiers

| | |
|---|---|
| Organization | Sam's Demo Organization — `f48e3c87-4ee0-4a74-8843-b9fa1c3d841f` |
| Project | `sp-demo` (Sam's Demo) |
| Connector | `reporter` — `c0ea4f4d-4922-4f41-8086-86dfa8a081e1` |
| Region | GCP Europe (`europe-west1`) |
| Blocking application | `reporting-app` (`merchant-center-custom-application`) |
| Publish target | Private use (not Marketplace) |

## The findings and where they come from

All findings in `reporting-app` are transitive dependencies of the mandatory MC custom-app build
toolchain — `@commercetools-frontend/mc-scripts` (webpack/babel/postcss build + dev server),
`@commercetools-frontend/jest-preset-mc-app` (Jest), and
`@commercetools-frontend/eslint-config-mc-app` (ESLint):

| Package | CVE(s) | Pulled in by | Role |
|---|---|---|---|
| `proxy-addr` | CVE-2026-90711 | `express` (mc-scripts dev server / `mc-scripts serve`) | build/dev server |
| `source-map-js` | CVE-2026-93749 | `postcss`, `css-tree` (postcss-svgo/csso) — mc-scripts CSS pipeline | build |
| `brace-expansion` | CVE-2026-102276, CVE-2026-102278 | `minimatch` ← `eslint`, `@jest/reporters`, `fork-ts-checker-webpack-plugin`, `test-exclude`, … | build/lint/test |
| `@grpc/grpc-js` | CVE-2026-101916 | optional transitive of the build toolchain (resolves only on the Linux build image) | build |

These packages are declared transitively through the `@commercetools-frontend/*` packages, which
are pinned in lockstep (all on `^27.9.3`) per the framework's version policy. We cannot upgrade
or override them away without diverging from the supported toolchain, and **no published version
clears these CVEs** — pinning each affected package to its latest release (attempted in tag
v0.1.6) produced a byte-identical SCA report.

## Why these do not reach production

A Merchant Center custom application is **compiled to static assets** (HTML/JS/CSS) by
`mc-scripts build` and served from a CDN. It has **no Node runtime and ships no `node_modules`**.

- `express`/`proxy-addr` is the local **dev server** — never built, never deployed.
- `postcss`/`source-map-js` and the webpack/`fork-ts-checker` chain run **at build time** to
  produce the bundle; the tools themselves are not in the bundle.
- `jest`/`eslint`/`minimatch`/`brace-expansion` are **test and lint** tooling, not application code.
- `@grpc/grpc-js` is a build-image-only optional transitive; it is not referenced by any
  application code and does not appear in the macOS install at all.

Webpack emits only the reachable application graph (React, UI Kit, ECharts, etc.); none of the
packages above are reachable from app entry points, so they are absent from the shipped bundle.

## What we have already done

To minimise the exception surface, every package the code *could* control has been removed from
the deployed trees (merged to `main`, commit `9d59919`):

- **3 framework backend apps** (`reporting-gateway`, `reporting-rollup-event`,
  `reporting-rollup-job`): `express` → Node's built-in `http` (gateway → Hono + a direct `jose`
  reimplementation of the MC session verifier); `vitest` → `node:test`.
- **All data-source connectors + the connector template**: same treatment.
- **`ga4-source`**: replaced the gRPC `@google-analytics/data` SDK with direct GA4 Data API REST
  calls (jose-signed service-account JWT), removing `@grpc/grpc-js` and `brace-expansion` there.

Result: `proxy-addr`, `source-map-js`, `tinypool`, `@grpc/grpc-js`, and `brace-expansion` are now
**absent from every backend and connector tree**. `reporting-app` is the only remaining app with
findings, and its findings are entirely the MC frontend toolchain described above, which is not
swappable.

## The ask

Any of the following would unblock a clean private-use publish:

1. **Exclude build/dev dependencies from SCA** for `merchant-center-custom-application` builds
   (the deployed artifact is static assets, not a dependency tree) — preferred, as it is correct
   in general for MC custom apps.
2. A **scoped CVE allowlist** for this connector covering: CVE-2026-90711, CVE-2026-93749,
   CVE-2026-102276, CVE-2026-102278, CVE-2026-101916.
3. A **private-connector SCA policy / severity threshold** for this org.

We can provide the full Publish Report, `npm ls` dependency paths, and the built bundle manifest
on request to confirm none of these packages are present in the deployed output.
