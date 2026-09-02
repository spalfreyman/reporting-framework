# Deploying the Reporting Framework to commercetools Connect

Status: private connector published; current release tag `v0.1.3` (installed to `sp-demo`).

- Framework connector: https://github.com/spalfreyman/reporting-framework (private)
- ct-native source connector: https://github.com/spalfreyman/reporting-source-ct-native (private)

Both grant read access to the `connect-mu` machine user (required for Connect to fetch a
private repo). The invitation is auto-accepted by Connect's automation; if the fetch step
fails with a permissions error, check the pending invite on each repo.

The whole CLI sequence below is run **by you**, because it needs the client secret
(`auth login`, and the secured `--configuration` values on `preview`). Nothing here should
be pasted into a chat.

---

## Prerequisites (only you can do these)

1. **Connect access on the credentials.** `auth login` uses a project API client. Connect
   management may require org-level authorization beyond `manage_project:sp-demo`. If
   `connectorstaged create` returns 403, use an API client with Connect management scope, or
   drive it from the Merchant Center (Manage organizations & teams → your org → Connect →
   Organization connectors), which uses your MC identity instead.

2. **Register the MC custom application** to obtain `CUSTOM_APPLICATION_ID` (required config
   for the `reporting-app`). Merchant Center → Organization settings → Custom Applications →
   Add. Use a placeholder Application URL for now; update it after deploy (step 6).
   - Entry point URI path: `reporting`
   - Permissions: the app config declares View/Manage + builder + datasources groups.

3. **Pick a `REPORTING_SHARED_SECRET`** — a long random string the gateway presents to the
   ct-native connector. It MUST be identical on both. Generate one:
   ```bash
   openssl rand -hex 32
   ```

---

## 1. Authenticate the CLI

```bash
commercetools auth login \
  --client-credentials \
  --client-id "$CTP_CLIENT_ID" \
  --client-secret "$CTP_CLIENT_SECRET" \
  --region europe-west1.gcp \
  --project-key sp-demo \
  --scope "manage_project:sp-demo"
```

## 2. (Optional) Validate locally — needs Docker

`commercetools connect validate` builds each app in a container to mirror Connect's pipeline.
It requires Docker, which is not installed on this machine. Either install a runtime
(`brew install colima docker && colima start`) and run:
```bash
commercetools connect validate .
```
…or skip it: the same validation runs server-side during `preview` below.

## 3. Create the ConnectorStaged (framework)

```bash
commercetools connect connectorstaged create \
  --key reporting-framework \
  --name "Reporting Framework" \
  --description "Pluggable ecommerce reporting for the Merchant Center." \
  --repository-url https://github.com/spalfreyman/reporting-framework \
  --repository-tag v0.1.0 \
  --creator-email sam.palfreyman@commercetools.com \
  --supported-regions europe-west1.gcp \
  --integration-types analytics
```

## 4. Preview-deploy the framework (validates + deploys)

`preview` runs the validation pipeline (fetch → verify connect.yaml → build → SCA → SAST)
and, if it passes, creates a short-lived preview deployment. Shared/global config keys use
the `KEY=value` form; app-specific keys use `app.KEY=value`.

```bash
commercetools connect connectorstaged preview \
  --key reporting-framework \
  --deployment-key reporting-framework-preview \
  --region europe-west1.gcp \
  --configuration "CTP_PROJECT_KEY=sp-demo" \
  --configuration "CTP_REGION=europe-west1.gcp" \
  --configuration "CLOUD_IDENTIFIER=gcp-eu" \
  --configuration "ROLLUP_TIMEZONE=UTC" \
  --configuration "CTP_CLIENT_ID=$CTP_CLIENT_ID" \
  --configuration "CTP_CLIENT_SECRET=$CTP_CLIENT_SECRET" \
  --configuration "CTP_SCOPE=manage_project:sp-demo" \
  --configuration "REPORTING_SHARED_SECRET=$REPORTING_SHARED_SECRET" \
  --configuration "reporting-app.CUSTOM_APPLICATION_ID=$CUSTOM_APPLICATION_ID" \
  --configuration "reporting-app.ENTRY_POINT_URI_PATH=reporting"
```

If the CLI rejects the global `KEY=value` form for a key an app doesn't declare, fall back to
the fully app-scoped form (every `reporting-gateway.CTP_CLIENT_ID=...`,
`reporting-rollup-event.CTP_CLIENT_ID=...`, etc.). All required keys per app are listed at the
bottom of this file.

Watch the build/validation:
```bash
commercetools connect connectorstaged describe --key reporting-framework
```
Look at `isPreviewable` (pending → true|false) and `previewableReport` for any SCA/SAST
findings.

## 5. ct-native source connector — same two steps

```bash
commercetools connect connectorstaged create \
  --key reporting-source-ct-native \
  --name "Reporting Source: commercetools" \
  --description "Native commercetools data source for the reporting framework." \
  --repository-url https://github.com/spalfreyman/reporting-source-ct-native \
  --repository-tag v0.1.0 \
  --creator-email sam.palfreyman@commercetools.com \
  --supported-regions europe-west1.gcp \
  --integration-types analytics

commercetools connect connectorstaged preview \
  --key reporting-source-ct-native \
  --deployment-key reporting-ct-native-preview \
  --region europe-west1.gcp \
  --configuration "CTP_PROJECT_KEY=sp-demo" \
  --configuration "CTP_REGION=europe-west1.gcp" \
  --configuration "CTP_CLIENT_ID=$CTP_CLIENT_ID" \
  --configuration "CTP_CLIENT_SECRET=$CTP_CLIENT_SECRET" \
  --configuration "CTP_SCOPE=manage_project:sp-demo" \
  --configuration "REPORTING_SHARED_SECRET=$REPORTING_SHARED_SECRET" \
  --configuration "ct-native-source.SOURCE_ID=ct-native" \
  --configuration "ct-native-source.MODE=live"
```

The connector's `postDeploy` upserts its descriptor to Custom Object
`reporting.datasources/ct-native`; the gateway discovers it within ~a minute — no framework
redeploy needed.

## 6. Finish the MC app wiring

After the framework preview is up, Connect assigns the custom app a URL. Update the Custom
Application registration's Application URL (step 2) to that URL, then reload the app in the
Merchant Center.

## 7. Tear down when done

Preview deployments are short-lived and scale to zero; delete them when finished testing:
```bash
commercetools connect deployment list --region europe-west1.gcp
commercetools connect deployment delete --key reporting-framework-preview --region europe-west1.gcp
commercetools connect deployment delete --key reporting-ct-native-preview --region europe-west1.gcp
```

## Going to production later

`preview` → fix any report findings → `connectorstaged publish` (certification:false for
private use) → `deployment create --connector-key <key> --type production` (needs a non-trial
project). Config changes are a **redeploy**, never delete+recreate.

---

## Required config keys per app (for the fully app-scoped fallback)

Framework:
- reporting-app: CUSTOM_APPLICATION_ID, ENTRY_POINT_URI_PATH, CLOUD_IDENTIFIER
- reporting-gateway: CTP_PROJECT_KEY, CTP_REGION, CLOUD_IDENTIFIER, CTP_CLIENT_ID*, CTP_CLIENT_SECRET*, CTP_SCOPE*, REPORTING_SHARED_SECRET*
- reporting-rollup-event: CTP_PROJECT_KEY, CTP_REGION, ROLLUP_TIMEZONE, CTP_CLIENT_ID*, CTP_CLIENT_SECRET*, CTP_SCOPE*
- reporting-rollup-job: CTP_PROJECT_KEY, CTP_REGION, ROLLUP_TIMEZONE, CTP_CLIENT_ID*, CTP_CLIENT_SECRET*, CTP_SCOPE*

ct-native:
- ct-native-source: CTP_PROJECT_KEY, CTP_REGION, SOURCE_ID, MODE, ROLLUP_TIMEZONE, CTP_CLIENT_ID*, CTP_CLIENT_SECRET*, CTP_SCOPE*, REPORTING_SHARED_SECRET*

(* = securedConfiguration)

Note on sp-demo: Product Search is not activated, so ct-native serves order metrics from the
rollup fact store and degrades the live catalogue-facet path cleanly. MODE stays `live`.

---

## Re-running after a build fix (shared-code vendoring)

The first preview build failed because Connect builds each app in an **isolated context**
rooted at the app folder — the repo-root `shared/` is not reachable, so the `prebuild` copy
step found nothing. Fixed by vendoring the shared contracts into each app at the release
tag (main stays clean; `src/shared` is still generated/gitignored there). All four framework
apps and ct-native now build locally with the exact `npm run build` the buildpack runs.

The `v0.1.0` tag on `reporting-framework` was moved to the fixed commit `364a050`
(ct-native's `v0.1.0` already pointed at a vendored commit). Connect clones the repo fresh on
each pipeline run, so simply **re-run the preview** to pick up the fix:

```bash
commercetools connect connectorstaged preview --key reporting-framework \
  --deployment-key reporting-framework-preview --region europe-west1.gcp \
  --configuration ...   # same config as before
```

If a re-preview appears to rebuild the old code (stale tag resolution), cut an unambiguous
new tag instead and point the staged connector at it:
```bash
git tag v0.1.1 && git push origin v0.1.1
commercetools connect connectorstaged update --key reporting-framework --repository-tag v0.1.1
```

## A Connect `job` is a long-running HTTP server, not a run-to-exit script

`v0.1.3` fixes a class of bug that fails the deploy at
"Health check for application reporting-rollup-job failed" **even when the job's own logic
runs and exits 0**. A Connect `job` is not a CLI invoked once: the platform's cron scheduler
triggers it by **POSTing to its `endpoint`**, the container must stay up and pass a liveness
probe, and it must reply `200`
([docs](https://docs.commercetools.com/connect/test-applications-locally#test-a-job-application)).
`service`, `event` and `job` all expose an endpoint and must listen on `PORT`.

So the rollup-job now boots an express server (`src/index.ts` → `createApp()` in `src/app.ts`)
exactly like the event app; `GET /rollup-job/status` is the liveness route and `POST
/rollup-job` runs one pass via `runJob()` (in `src/job.ts`) and returns `200`. The old
`runJob(); process.exit(0)` entrypoint never opened a port, so nothing answered the probe.

The same shape is required for the two other job apps that ship in `connectors/` —
`ga4-prewarm-job` and `erp-oms-extract-job` — before those connectors are deployed.

### Publishing a new release (what worked in the MC UI)

The whole loop is doable in the Merchant Center without a CLI:
1. Push the code to `main`, then cut a **new tag** (`git tag v0.1.3 && git push origin v0.1.3`).
   The tag must **vendor `shared/` into each app** (`node scripts/sync-shared.mjs --all`, then
   `git add -f <app>/src/shared <app>/src/shared-node`) because Connect builds each app in an
   isolated context rooted at the app folder — the repo-root `shared/` is not reachable. Keep
   the vendored copies **off `main`** (they are gitignored); commit them only on the tag.
2. Organization settings → Connect → **Organization connectors** → *Manage connectors* →
   open the connector → **Connector Details → Edit** → re-select the Git provider → pick the
   new **Tag** → **Re-publish**. Status goes `Publishing` → `Published`.
3. A **Redeploy** of an existing installation reuses the version it was created with, so it
   does **not** pick up the new tag — do a **fresh Install** of the now-current version
   (re-enter config + secrets), then uninstall the old failed deployment.
