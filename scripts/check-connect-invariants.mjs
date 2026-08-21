#!/usr/bin/env node
/**
 * Guards the Connect layout rules that are easy to break and expensive to discover late:
 *
 *  1. Every deployAs[].name in the root connect.yaml has a matching root-sibling folder.
 *  2. deployAs[].name uses only [A-Za-z0-9_-] (Connect's charset — no slashes, so apps
 *     cannot be nested).
 *  3. No folder named in the root connect.yaml lives under connectors/ — the sample
 *     data-source connectors must stay inert to the framework's own deploy.
 *  4. Each connectors/<name>/connect.yaml only references folders inside its own subtree.
 *  5. The MC custom application declares neither securedConfiguration nor APPLICATION_URL.
 *  6. Every `job` declares properties.schedule.
 *  7. The root package.json has no "workspaces" field.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checked = [];

/** Minimal deployAs extractor: splits the file on top-level `- name:` entries. */
const parseDeployAs = (text) => {
  const blocks = [];
  const lines = text.split('\n');
  let current = null;
  for (const line of lines) {
    const nameMatch = line.match(/^\s*-\s+name:\s*['"]?([^'"\s#]+)/);
    if (nameMatch) {
      if (current) blocks.push(current);
      current = { name: nameMatch[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((b) => {
    const body = b.lines.join('\n');
    const type = body.match(/applicationType:\s*['"]?([\w-]+)/);
    return {
      name: b.name,
      applicationType: type ? type[1] : null,
      body,
    };
  });
};

const NAME_CHARSET = /^[A-Za-z0-9_-]+$/;

const checkConnectFile = (yamlPath, { allowedRoot, forbidUnder }) => {
  const text = fs.readFileSync(yamlPath, 'utf8');
  const apps = parseDeployAs(text);
  const rel = path.relative(REPO_ROOT, yamlPath);
  if (apps.length === 0) problems.push(`${rel}: no deployAs entries found`);

  for (const app of apps) {
    checked.push(`${rel} :: ${app.name} (${app.applicationType})`);

    if (!NAME_CHARSET.test(app.name)) {
      problems.push(`${rel}: deployAs name "${app.name}" must match [A-Za-z0-9_-]+`);
    }

    const appDir = path.join(allowedRoot, app.name);
    if (!fs.existsSync(appDir)) {
      problems.push(`${rel}: no folder "${app.name}" beside it (expected ${path.relative(REPO_ROOT, appDir)})`);
    }

    if (forbidUnder && fs.existsSync(path.join(forbidUnder, app.name))) {
      problems.push(
        `${rel}: app "${app.name}" also exists under ${path.relative(REPO_ROOT, forbidUnder)}/ — ` +
          `framework apps and sample connectors must not overlap`
      );
    }

    if (app.applicationType === 'merchant-center-custom-application') {
      if (/securedConfiguration/.test(app.body)) {
        problems.push(`${rel}: "${app.name}" is an MC custom application and must not declare securedConfiguration`);
      }
      if (/key:\s*APPLICATION_URL/.test(app.body)) {
        problems.push(`${rel}: "${app.name}" must not declare APPLICATION_URL — Connect injects it`);
      }
    }

    if (app.applicationType === 'job' && !/schedule:/.test(app.body)) {
      problems.push(`${rel}: job "${app.name}" must declare properties.schedule`);
    }
  }
};

const connectorsRoot = path.join(REPO_ROOT, 'connectors');

checkConnectFile(path.join(REPO_ROOT, 'connect.yaml'), {
  allowedRoot: REPO_ROOT,
  forbidUnder: fs.existsSync(connectorsRoot) ? connectorsRoot : null,
});

if (fs.existsSync(connectorsRoot)) {
  for (const entry of fs.readdirSync(connectorsRoot)) {
    const dir = path.join(connectorsRoot, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const yamlPath = path.join(dir, 'connect.yaml');
    if (!fs.existsSync(yamlPath)) {
      problems.push(`connectors/${entry}: missing its own connect.yaml`);
      continue;
    }
    checkConnectFile(yamlPath, { allowedRoot: dir, forbidUnder: null });
  }
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
if (rootPkg.workspaces) {
  problems.push(
    'root package.json declares "workspaces" — Connect installs inside each app folder, ' +
      'so a workspaces root makes every app pull in every package'
  );
}

console.log(checked.map((c) => `  checked  ${c}`).join('\n'));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nConnect layout invariants hold.');
