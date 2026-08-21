#!/usr/bin/env node
/**
 * Materialises `connectors/<name>/` into a standalone connector repository.
 *
 * Connect's GitHub integration expects `connect.yaml` at the REPOSITORY root, so a nested
 * connector cannot be deployed in place. Keeping the samples here makes them reviewable and
 * runnable from one checkout; this script is the documented path to shipping one for real.
 *
 * It hoists the connector's connect.yaml to the target root, copies each app folder as a
 * root sibling, INLINES the shared trees (so the standalone repo has no external
 * dependency on this one), and rewrites each app's sync:shared script to a no-op.
 *
 * Usage:
 *   node scripts/split-connector.mjs ct-native ../reporting-source-ct-native
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, targetArg] = process.argv.slice(2);

if (!name || !targetArg) {
  console.error('Usage: node scripts/split-connector.mjs <connector-name> <target-dir>');
  process.exit(1);
}

const sourceDir = path.join(REPO_ROOT, 'connectors', name);
const targetDir = path.resolve(process.cwd(), targetArg);
const connectYaml = path.join(sourceDir, 'connect.yaml');

if (!fs.existsSync(connectYaml)) {
  console.error(`No connect.yaml at ${path.relative(REPO_ROOT, connectYaml)}`);
  process.exit(1);
}

if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
  console.error(`Target ${targetDir} exists and is not empty. Refusing to overwrite.`);
  process.exit(1);
}

const yaml = fs.readFileSync(connectYaml, 'utf8');
const apps = [...yaml.matchAll(/^\s*-\s+name:\s*(\S+)/gm)].map((m) => m[1].replace(/['"]/g, ''));

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(connectYaml, path.join(targetDir, 'connect.yaml'));

const IGNORED = new Set(['node_modules', 'dist', '.shared-hash']);

for (const app of apps) {
  const from = path.join(sourceDir, app);
  if (!fs.existsSync(from)) {
    console.error(`connect.yaml names "${app}" but ${path.relative(REPO_ROOT, from)} is missing`);
    process.exit(1);
  }
  const to = path.join(targetDir, app);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !IGNORED.has(path.basename(src)),
  });

  // Inline the shared trees so the standalone repo stands alone.
  fs.rmSync(path.join(to, 'src', 'shared'), { recursive: true, force: true });
  fs.rmSync(path.join(to, 'src', 'shared-node'), { recursive: true, force: true });
  fs.cpSync(path.join(REPO_ROOT, 'shared', 'src'), path.join(to, 'src', 'shared'), {
    recursive: true,
  });
  const nodeShared = path.join(REPO_ROOT, 'shared-node', 'src');
  const wantsNode = fs.existsSync(path.join(from, 'src', 'shared-node'));
  if (wantsNode && fs.existsSync(nodeShared)) {
    fs.cpSync(nodeShared, path.join(to, 'src', 'shared-node'), { recursive: true });
  }

  /**
   * The app's .gitignore excludes src/shared, because in the monorepo that directory is
   * generated. Here it is VENDORED and must be committed — leaving the ignore in place
   * would produce a repo that builds locally and then deploys with no framework contracts
   * at all.
   */
  const appIgnore = path.join(to, '.gitignore');
  if (fs.existsSync(appIgnore)) {
    const kept = fs
      .readFileSync(appIgnore, 'utf8')
      .split('\n')
      .filter((line) => !/^\**\/?src\/shared/.test(line.trim()) && !line.includes('.shared-hash'));
    fs.writeFileSync(appIgnore, kept.join('\n'));
  }

  // The sync step no longer applies: shared code is now part of this repo, and a copy
  // script that silently found nothing would be worse than one that says so.
  const pkgPath = path.join(to, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.scripts['sync:shared'] =
    'node -e "console.log(\'shared code is vendored in this repository; nothing to sync\')"';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.rmSync(path.join(to, 'scripts', 'sync-shared.mjs'), { force: true });

  console.log(`  app      ${app}`);
}

fs.writeFileSync(path.join(targetDir, '.nvmrc'), '22\n');
fs.writeFileSync(
  path.join(targetDir, '.gitignore'),
  ['node_modules/', 'dist/', '.env', '*.log', '.DS_Store', ''].join('\n')
);
fs.writeFileSync(
  path.join(targetDir, 'README.md'),
  [
    `# reporting-source-${name}`,
    '',
    'A commercetools Connect data-source connector for the reporting framework.',
    '',
    'Split out of the reporting framework monorepo with `scripts/split-connector.mjs`.',
    'The framework contracts under `*/src/shared` are vendored: re-run the split to update',
    'them rather than editing them here, or they will drift from the framework.',
    '',
    '## Deploy',
    '',
    '```bash',
    'git init && git add -A && git commit -m "initial" && git tag v0.1.0',
    '# then, with the Connect CLI:',
    'commercetools connect connectorstaged create --repo <url> --tag v0.1.0',
    'commercetools connect connectorstaged publish',
    'commercetools connect deployment create --connector <key> --region <region>',
    '```',
    '',
    'After deploying, its `postDeploy` publishes a capability descriptor to Custom Object',
    '`reporting.datasources/<SOURCE_ID>`, and the reporting gateway picks it up within a',
    'minute. No framework redeploy is needed.',
    '',
  ].join('\n')
);

console.log(`\nSplit connectors/${name} -> ${targetDir}`);
console.log(`  apps: ${apps.join(', ')}`);
console.log('  shared contracts vendored; sync:shared disabled');
