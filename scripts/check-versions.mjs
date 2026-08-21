#!/usr/bin/env node
/**
 * All @commercetools-frontend/* packages must sit on the SAME version. They are released
 * in lockstep and mixing them breaks the application shell at runtime — with errors that
 * do not point at the cause.
 *
 * Also checks that Connect backend apps use the modern SDK pair rather than the legacy
 * @commercetools/sdk-client-v2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const findPackageJsons = (dir, depth = 0) => {
  if (depth > 3) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findPackageJsons(full, depth + 1));
    else if (entry.name === 'package.json') out.push(full);
  }
  return out;
};

const frontendVersions = new Map();

for (const file of findPackageJsons(REPO_ROOT)) {
  const rel = path.relative(REPO_ROOT, file);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [name, range] of Object.entries(deps)) {
    if (name.startsWith('@commercetools-frontend/')) {
      if (!frontendVersions.has(range)) frontendVersions.set(range, []);
      frontendVersions.get(range).push(`${rel} :: ${name}`);
    }
    if (name === '@commercetools/sdk-client-v2') {
      problems.push(
        `${rel}: uses the legacy @commercetools/sdk-client-v2 — use @commercetools/ts-client instead`
      );
    }
  }
}

if (frontendVersions.size > 1) {
  problems.push(
    '@commercetools-frontend/* packages are on mixed versions (they must be identical):\n' +
      [...frontendVersions.entries()]
        .map(([range, users]) => `      ${range}\n${users.map((u) => `        ${u}`).join('\n')}`)
        .join('\n')
  );
} else if (frontendVersions.size === 1) {
  console.log(`  @commercetools-frontend/* all on ${[...frontendVersions.keys()][0]}`);
} else {
  console.log('  no @commercetools-frontend/* packages yet');
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('Version invariants hold.');
