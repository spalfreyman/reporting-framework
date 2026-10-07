# Deploying the Merchant Center app (`reporting-app`) standalone

The reporting UI is **not** deployed by the Connect connector. Connect's software-composition
analysis scans the full build dependency tree of every app it builds, and the mandatory
`@commercetools-frontend/mc-scripts` + `jest` + `eslint` toolchain pulls transitive packages the
SCA flags (`proxy-addr`, `source-map-js`, `brace-expansion`, `@grpc/grpc-js`) that no released
version clears — and that never reach the compiled static bundle. There is no way to remove them
while still building an MC custom app, so the app is deployed the standard way: as a **self-hosted
Merchant Center Custom Application**.

This costs no wiring. The app has no secrets (it reaches the backend through the MC API Gateway's
`/proxy/forward-to`), and it discovers this connector's gateway at boot from the Custom Object
`reporting.config/gateway` that `reporting-gateway` publishes on postDeploy. You only need to
build it, host the static output, and register it in the Merchant Center.

See the official guide for background:
https://docs.commercetools.com/merchant-center-customizations/concepts/deployment

## Prerequisites

- The `reporter` connector is installed on the project (so the gateway is running and has
  published its URL to `reporting.config/gateway`).
- Node 22, from this folder (`reporting-app/`).
- A static HTTPS host for the built assets (Vercel, Netlify, Cloudflare Pages, GCS+CDN, S3+CloudFront, …).

## 1. Register the Custom Application (get the application ID)

In the Merchant Center: **Organization settings → Custom Applications → Configure a Custom
Application**. Use the values from [`custom-application-config.mjs`](../reporting-app/custom-application-config.mjs):

- Entry point URI path: `reporting`
- Permissions + main/submenu links: as declared in that file (or push them with
  `mc-scripts config:sync` once the app URL is known).

Copy the generated **Application ID** — it becomes `CUSTOM_APPLICATION_ID` below. (You can register
with a placeholder URL first and update it once hosting is live.)

## 2. Build and compile for production

```bash
cd reporting-app
npm install
npm run build        # mc-scripts build  -> static assets in ./public
```

Then compile `index.html` for production, supplying the values Connect used to inject:

```bash
CUSTOM_APPLICATION_ID="<application-id-from-step-1>" \
APPLICATION_URL="https://<your-host>/<base-path>/" \
CLOUD_IDENTIFIER="gcp-eu" \
npm run compile-html   # mc-scripts compile-html
```

Notes:
- `APPLICATION_URL` must be the exact HTTPS URL the assets are served from (trailing slash matters).
- `CLOUD_IDENTIFIER` is your project's region (`gcp-eu`, `gcp-us`, `aws-eu`, `aws-us`, `gcp-au`).
- `REPORTING_GATEWAY_URL` is **optional** and normally omitted — the app auto-discovers the
  gateway from `reporting.config/gateway`. Set it only to pin a non-Connect gateway.

## 3. Host the `public/` directory

Upload `reporting-app/public/` to your static host at `APPLICATION_URL`. The app is a SPA, so
configure the host to serve `index.html` for unknown sub-paths (history-API fallback).

## 4. Point the registered app at the live URL

Back in the Custom Application registration, set the application URL to `APPLICATION_URL` and
confirm the permissions/menu links. Assign the reporting permissions (`ViewReporting`, etc.) to
the relevant Merchant Center teams.

## Updating

Re-run step 2 (build + compile-html) and re-upload `public/`. No connector redeploy is needed
unless the gateway URL changes — and even then the app rediscovers it from the Custom Object at
boot.

## Local development

Unchanged: `npm run start` (talks to a local/dev gateway via the CSP `connect-src` allowances in
`custom-application-config.mjs`), or `npm run start:prod:local` to serve a production-compiled
build locally.
