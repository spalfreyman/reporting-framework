#!/usr/bin/env node
/**
 * Runs an npm script across every app in the repo — the framework apps named in the root
 * connect.yaml, each connector's apps, and `shared`.
 *
 * There is no workspace root to do this for us (deliberately: Connect installs inside each
 * app folder, so a workspaces root would make every app pull in every package), hence this.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = process.argv[2];

if (!script) {
  console.error('Usage: node scripts/fan-out.mjs <npm-script>');
  process.exit(1);
}

const appsFromYaml = (yamlPath) => {
  if (!fs.existsSync(yamlPath)) return [];
  return [...fs.readFileSync(yamlPath, 'utf8').matchAll(/^\s*-\s+name:\s*(\S+)/gm)].map((m) =>
    m[1].replace(/['"]/g, '')
  );
};

const targets = [path.join(REPO_ROOT, 'shared')];

for (const name of appsFromYaml(path.join(REPO_ROOT, 'connect.yaml'))) {
  const dir = path.join(REPO_ROOT, name);
  if (fs.existsSync(path.join(dir, 'package.json'))) targets.push(dir);
}

const connectorsRoot = path.join(REPO_ROOT, 'connectors');
if (fs.existsSync(connectorsRoot)) {
  for (const connector of fs.readdirSync(connectorsRoot)) {
    const connectorDir = path.join(connectorsRoot, connector);
    if (!fs.statSync(connectorDir).isDirectory()) continue;
    for (const name of appsFromYaml(path.join(connectorDir, 'connect.yaml'))) {
      const dir = path.join(connectorDir, name);
      if (fs.existsSync(path.join(dir, 'package.json'))) targets.push(dir);
    }
  }
}

let failures = 0;

for (const dir of targets) {
  const label = path.relative(REPO_ROOT, dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!pkg.scripts?.[script]) {
    console.log(`\n--- ${label}: no "${script}" script, skipping`);
    continue;
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    console.log(`\n--- ${label}: dependencies not installed, skipping (run npm install there)`);
    continue;
  }

  console.log(`\n=== ${label}: npm run ${script} ===`);
  try {
    execFileSync('npm', ['run', '--silent', script], { cwd: dir, stdio: 'inherit' });
  } catch {
    failures += 1;
    console.error(`FAILED: ${label}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} app(s) failed "${script}".`);
  process.exit(1);
}
console.log(`\nAll apps passed "${script}".`);
