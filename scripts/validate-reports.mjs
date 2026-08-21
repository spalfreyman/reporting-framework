#!/usr/bin/env node
/**
 * Validates every built-in report definition against the zod schema, and checks that every
 * metric and dimension it references actually exists in the registry.
 *
 * This is the M1 gate: a report that references a metric nobody serves, or joins a
 * non-conformed dimension, should fail CI rather than render a broken tile in production.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = path.join(REPO_ROOT, 'shared', 'src', 'catalogue');

if (!fs.existsSync(CATALOGUE)) {
  console.log('no report catalogue yet — nothing to validate');
  process.exit(0);
}

const reports = fs
  .readdirSync(CATALOGUE, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.report.ts'));

if (reports.length === 0) {
  console.log('no *.report.json files yet — nothing to validate');
  process.exit(0);
}

// Delegate to the shared package's own validator so there is exactly one source of truth.
const runner = path.join(REPO_ROOT, 'shared', 'scripts', 'validate-catalogue.ts');
if (!fs.existsSync(runner)) {
  console.error(`expected validator at ${path.relative(REPO_ROOT, runner)}`);
  process.exit(1);
}

try {
  const output = execFileSync('npx', ['tsx', runner], {
    cwd: path.join(REPO_ROOT, 'shared'),
    encoding: 'utf8',
  });
  process.stdout.write(output);
} catch (error) {
  process.stdout.write(error.stdout ?? '');
  process.stderr.write(error.stderr ?? '');
  process.exit(1);
}
