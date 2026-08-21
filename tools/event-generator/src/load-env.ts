import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads the tool's own `.env`, OVERRIDING any ambient variables.
 *
 * This override is deliberate and safety-relevant: the machine's global settings preset
 * `CTP_*` for an unrelated project, and this tool WRITES orders. Reading ambient env would
 * silently target the wrong project. The `.env` beside the tool is the single source of
 * truth for which project we write to.
 */
export const loadEnv = (file = path.join(process.cwd(), '.env')): void => {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // CTP_* (which project we WRITE to) always comes from .env — never inherit it from the
    // machine's ambient settings, which point at a different project. Everything else
    // (GEN_* tuning) only fills a gap, so a CLI override like `GEN_DAYS=3 npm run seed` wins.
    if (key.startsWith('CTP_') || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
};
