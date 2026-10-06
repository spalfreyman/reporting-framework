#!/usr/bin/env node
/**
 * Copies `shared/src` into an application's `src/shared`.
 *
 * Why a copy step rather than a relative import: `shared/` cannot be an npm workspace
 * (Connect runs `install` inside each app folder independently), and it cannot be imported
 * by relative path either, because mc-scripts' babel-loader `include` and each Node app's
 * tsconfig `rootDir` both reject files above the app root.
 *
 * Wired to prebuild/predev/pretest in every app. The destination is gitignored.
 * A `.shared-hash` file records what was copied, so a stale tree is detectable in CI.
 *
 * This script is SELF-LOCATING: it walks up from its own location to find the repo root
 * (the nearest ancestor containing `shared/src`), so the identical file works whether it
 * lives at `scripts/`, `<app>/scripts/`, or `connectors/<c>/<app>/scripts/`.
 *
 * `shared/` is deliberately free of Node-only dependencies, because it is bundled into the
 * webpack-built Merchant Center app. Code that needs the commercetools SDK lives in
 * `shared-node/` instead and is copied only into backend apps that ask for it with
 * `--with-node`.
 *
 * `shared/` writes its own relative imports with explicit `.js` extensions, which Node ESM
 * requires. Webpack cannot resolve those against `.ts` files on disk, so `--bundler-imports`
 * strips the extension while copying. The copy is generated code, so rewriting it there is
 * the natural place to reconcile the two module resolvers rather than compromising either.
 *
 * Usage:
 *   node scripts/sync-shared.mjs                    # sync the app this script lives inside
 *   node scripts/sync-shared.mjs --with-node        # also copy shared-node/src
 *   node scripts/sync-shared.mjs --bundler-imports  # strip .js from relative imports (webpack)
 *   node scripts/sync-shared.mjs --all              # every app in connect.yaml + connectors/
 *   node scripts/sync-shared.mjs --check            # exit 1 if any destination is stale
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Nearest ancestor of this script that contains `shared/src`. */
const findRepoRoot = (start) => {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'shared', 'src'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

const REPO_ROOT = findRepoRoot(SCRIPT_DIR);
if (!REPO_ROOT) {
  /**
   * In a commercetools Connect build each application is built in an isolated context
   * rooted at its own folder — the repo-root `shared/src` is NOT in that context, so the
   * ancestor walk finds nothing. If the shared tree has been vendored into the app
   * (committed at the release tag; see the deploy runbook), there is nothing to copy: use
   * it as-is. Only fail when there is neither a source tree to copy from nor a vendored
   * copy to fall back on — a genuinely broken checkout.
   */
  const ownAppDir = path.dirname(SCRIPT_DIR);
  if (fs.existsSync(path.join(ownAppDir, 'src', 'shared'))) {
    console.log(
      'sync:shared: no shared/src in the build context; using vendored src/shared as-is'
    );
    process.exit(0);
  }
  console.error(
    `Could not find shared/src in any ancestor of ${SCRIPT_DIR}, and no vendored src/shared to fall back on`
  );
  process.exit(1);
}
const SOURCE = path.join(REPO_ROOT, 'shared', 'src');
const NODE_SOURCE = path.join(REPO_ROOT, 'shared-node', 'src');

const listFiles = (dir, base = dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full, base);
    return [path.relative(base, full)];
  });
};

/** Content hash over a tree, so any edit anywhere changes it. */
const hashTree = (root) => {
  const hash = createHash('sha256');
  for (const rel of listFiles(root).sort()) {
    hash.update(rel);
    hash.update(fs.readFileSync(path.join(root, rel)));
  }
  return hash.digest('hex');
};

/**
 * Rewrites `from './x.js'` to `from './x'` in relative imports only.
 *
 * Package specifiers and `node:` builtins are left alone; only paths beginning with `./` or
 * `../` are touched.
 */
const stripJsExtensions = (source) =>
  source.replace(
    /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+?)\.js\2/g,
    (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier}${quote}`
  );

const copyTree = (from, to, { bundlerImports = false } = {}) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });

  if (!bundlerImports) return;
  for (const rel of listFiles(to)) {
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(rel)) continue;
    const file = path.join(to, rel);
    const original = fs.readFileSync(file, 'utf8');
    const rewritten = stripJsExtensions(original);
    if (rewritten !== original) fs.writeFileSync(file, rewritten);
  }
};

/**
 * An app opts into shared-node by having a `src/shared-node` directory already, or by
 * passing --with-node. Once opted in it stays opted in, so a --check run does not report a
 * false positive.
 */
const wantsNode = (appDir, requested) =>
  requested || fs.existsSync(path.join(appDir, 'src', 'shared-node'));

const syncInto = (appDir, { check = false, withNode = false, bundlerImports = false } = {}) => {
  const dest = path.join(appDir, 'src', 'shared');
  const nodeDest = path.join(appDir, 'src', 'shared-node');
  const hashFile = path.join(appDir, '.shared-hash');
  const label = path.relative(REPO_ROOT, appDir) || '.';

  const includeNode = wantsNode(appDir, withNode) && fs.existsSync(NODE_SOURCE);
  // The import style is part of what was written, so it belongs in the hash: flipping the
  // flag must invalidate an existing copy.
  const variant = bundlerImports ? 'bundler' : 'node';
  const expected = includeNode
    ? `${variant}:${hashTree(SOURCE)}:${hashTree(NODE_SOURCE)}`
    : `${variant}:${hashTree(SOURCE)}`;
  const actual = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8').trim() : null;

  const present = fs.existsSync(dest) && (!includeNode || fs.existsSync(nodeDest));

  if (check) {
    const stale = actual !== expected || !present;
    console.log(`${stale ? 'STALE  ' : 'ok     '} ${label}`);
    return !stale;
  }

  if (actual === expected && present) {
    console.log(`ok      ${label} (unchanged)`);
    return true;
  }

  copyTree(SOURCE, dest, { bundlerImports });
  if (includeNode) copyTree(NODE_SOURCE, nodeDest, { bundlerImports });
  fs.writeFileSync(hashFile, `${expected}\n`);
  console.log(
    `synced  ${label}${includeNode ? ' (+ shared-node)' : ''}${
      bundlerImports ? ' [bundler imports]' : ''
    }`
  );
  return true;
};

const appsFromConnectYaml = (yamlPath) => {
  if (!fs.existsSync(yamlPath)) return [];
  const text = fs.readFileSync(yamlPath, 'utf8');
  return [...text.matchAll(/^\s*-\s+name:\s*(\S+)/gm)].map((m) => m[1].replace(/['"]/g, ''));
};

const discoverAppDirs = () => {
  const dirs = [];
  for (const name of appsFromConnectYaml(path.join(REPO_ROOT, 'connect.yaml'))) {
    const dir = path.join(REPO_ROOT, name);
    if (fs.existsSync(dir)) dirs.push(dir);
  }
  const connectorsRoot = path.join(REPO_ROOT, 'connectors');
  if (fs.existsSync(connectorsRoot)) {
    for (const connector of fs.readdirSync(connectorsRoot)) {
      const connectorDir = path.join(connectorsRoot, connector);
      if (!fs.statSync(connectorDir).isDirectory()) continue;
      for (const name of appsFromConnectYaml(path.join(connectorDir, 'connect.yaml'))) {
        const dir = path.join(connectorDir, name);
        if (fs.existsSync(dir)) dirs.push(dir);
      }
    }
  }
  return dirs;
};

const args = process.argv.slice(2);
const check = args.includes('--check');
const all = args.includes('--all');
const withNode = args.includes('--with-node');
const bundlerImports = args.includes('--bundler-imports');

/**
 * When invoked from inside an app (the common case, via a prebuild hook), the target is the
 * parent of this script's own directory — not process.cwd(), which npm may set elsewhere.
 */
const ownApp = path.dirname(SCRIPT_DIR);
const isAtRepoRoot = path.resolve(ownApp) === path.resolve(REPO_ROOT);

const targets = all || check ? discoverAppDirs() : isAtRepoRoot ? [] : [ownApp];

if (targets.length === 0) {
  if (isAtRepoRoot && !all && !check) {
    console.log('run with --all from the repo root, or from inside an app folder');
  } else {
    console.log('no app folders found yet — nothing to sync');
  }
  process.exit(0);
}

/**
 * A Merchant Center custom application is detected by its config file. Its bundle is built
 * by webpack, so it always needs the bundler import style — inferring it means an app cannot
 * be broken by someone forgetting the flag.
 */
const isMerchantCenterApp = (dir) =>
  ['custom-application-config.mjs', 'custom-application-config.json', 'custom-view-config.mjs'].some(
    (file) => fs.existsSync(path.join(dir, file))
  );

const results = targets.map((dir) =>
  syncInto(dir, {
    check,
    withNode,
    bundlerImports: bundlerImports || isMerchantCenterApp(dir),
  })
);
if (check && results.some((ok) => !ok)) {
  console.error('\nStale shared/ copies. Run `yarn sync:shared` — and never commit src/shared/.');
  process.exit(1);
}
