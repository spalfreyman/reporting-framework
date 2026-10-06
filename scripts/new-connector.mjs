#!/usr/bin/env node
/**
 * Scaffold a new reporting data-source connector from the template.
 *
 * Copies scripts/templates/data-source-connector/ into connectors/<sourceId>/, renaming the
 * two app folders (`source` → `<sourceId>-source`, `prewarm-job` → `<sourceId>-prewarm-job`),
 * renaming `gitignore` → `.gitignore`, and substituting the placeholder tokens. The result is
 * a complete, buildable connector (a `service` that answers /query + a scheduled `job`) that
 * serves self-contained synthetic data until you wire in a real upstream.
 *
 * Usage:
 *   node scripts/new-connector.mjs <source-id> [options]
 *
 *   <source-id>                lowercase [a-z0-9-], e.g. "warehouse" or "erp-oms"
 *   --name "Display Name"      shown in the MC data-source admin (default: Title-cased id)
 *   --kind <kind>             commerce | web-analytics | erp | oms | warehouse | custom  (default: custom)
 *   --source-port <n>          service dev PORT default (default: 8090)
 *   --job-port <n>             job dev PORT default (default: 8091)
 *   --description "..."        package/README description
 *   --target <dir>             output dir (default: connectors/<source-id>)
 *   --force                    overwrite an existing target
 *
 * Example:
 *   node scripts/new-connector.mjs warehouse --name "Warehouse SQL" --kind warehouse
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(REPO_ROOT, 'scripts', 'templates', 'data-source-connector');

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// ── Parse args ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--force') opts.force = true;
  else if (a.startsWith('--')) {
    opts[a.slice(2)] = argv[i + 1];
    i += 1;
  } else positional.push(a);
}

const sourceId = positional[0];
if (!sourceId) die('missing <source-id>. Usage: node scripts/new-connector.mjs <source-id> [--name ...]');
if (!/^[a-z0-9-]+$/.test(sourceId)) die(`source-id "${sourceId}" must match [a-z0-9-]+ (lowercase, digits, hyphens)`);
if (sourceId.endsWith('-source') || sourceId.endsWith('-prewarm-job'))
  die(`source-id should be the bare id (e.g. "warehouse"), not "${sourceId}" — the app suffixes are added for you`);

const titleCase = (s) => s.replace(/(^|-)([a-z0-9])/g, (_m, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase()).trim();
const KINDS = ['commerce', 'web-analytics', 'erp', 'oms', 'warehouse', 'custom'];
const kind = opts.kind ?? 'custom';
if (!KINDS.includes(kind)) die(`--kind must be one of: ${KINDS.join(', ')}`);

const tokens = {
  __SOURCE_ID__: sourceId,
  __DISPLAY_NAME__: opts.name ?? `${titleCase(sourceId)} Data Source`,
  __KIND__: kind,
  __SOURCE_PORT__: String(opts['source-port'] ?? 8090),
  __JOB_PORT__: String(opts['job-port'] ?? 8091),
  __DESCRIPTION__:
    opts.description ??
    `Reporting data source for ${opts.name ?? titleCase(sourceId)}. Generated from the data-source-connector template; serves synthetic data until a real upstream is wired in.`,
};

const target = path.resolve(REPO_ROOT, opts.target ?? path.join('connectors', sourceId));
if (!fs.existsSync(TEMPLATE)) die(`template not found at ${path.relative(REPO_ROOT, TEMPLATE)}`);
if (fs.existsSync(target) && !opts.force) die(`target ${path.relative(REPO_ROOT, target)} already exists (use --force to overwrite)`);

// ── Copy tree with folder renames + token substitution ─────────────────────────────────
const APP_RENAMES = { source: `${sourceId}-source`, 'prewarm-job': `${sourceId}-prewarm-job` };
const SKIP = new Set(['node_modules', 'dist', 'shared', 'shared-node', '.shared-hash']);
const substitute = (text) => Object.entries(tokens).reduce((acc, [k, v]) => acc.split(k).join(v), text);

let fileCount = 0;
const walk = (srcDir, destDir) => {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    // Rename the two app folders and gitignore; everything else keeps its name.
    const destName = APP_RENAMES[entry.name] ?? (entry.name === 'gitignore' ? '.gitignore' : entry.name);
    const destPath = path.join(destDir, destName);
    if (entry.isDirectory()) {
      walk(srcPath, destPath);
    } else {
      const raw = fs.readFileSync(srcPath, 'utf8');
      fs.writeFileSync(destPath, substitute(raw));
      fileCount += 1;
    }
  }
};

walk(TEMPLATE, target);

const rel = path.relative(REPO_ROOT, target);
console.log(`✓ Created connector "${sourceId}" at ${rel} (${fileCount} files)`);
console.log(`  apps: ${sourceId}-source (service), ${sourceId}-prewarm-job (job)`);
console.log('\nNext steps:');
console.log(`  1. Edit ${rel}/${sourceId}-source/src/descriptor.ts (declare capabilities) and src/data.ts (serve data).`);
console.log(`  2. Build:   cd ${rel}/${sourceId}-source && npm install && npm run build`);
console.log(`  3. Verify:  yarn check:connect`);
console.log(`  4. Ship:    node scripts/split-connector.mjs ${sourceId} ../reporting-source-${sourceId}`);
