import { CO } from '../shared/schema/descriptor.js';
import {
  dataSourceDescriptorSchema,
  type DataSourceDescriptor,
} from '../shared/schema/descriptor.js';
import type { CustomObjectPort } from '../shared/ct/ports.js';
import type { Logger } from '../logger.js';

/**
 * The data-source registry.
 *
 * Each data-source connector's postDeploy upserts its own capability descriptor into the
 * `reporting.datasources` container. The gateway reads that container to learn what exists.
 *
 * The consequence worth stating: installing a connector extends the framework with NO
 * framework redeploy, and uninstalling one degrades the affected reports rather than
 * breaking them.
 */

export interface Registry {
  sources: DataSourceDescriptor[];
  loadedAt: number;
  /** Descriptors that failed validation, kept so the admin UI can show the operator why. */
  invalid: Array<{ key: string; problem: string }>;
}

const REFRESH_MS = 60_000;

export class RegistryCache {
  private current: Registry = { sources: [], loadedAt: 0, invalid: [] };
  private inFlight: Promise<Registry> | null = null;

  constructor(
    private readonly port: CustomObjectPort,
    private readonly log: Logger,
    private readonly refreshMs = REFRESH_MS
  ) {}

  async get(now: number = Date.now()): Promise<Registry> {
    if (now - this.current.loadedAt < this.refreshMs && this.current.loadedAt > 0) {
      return this.current;
    }
    // Collapse concurrent refreshes so a burst of requests does not fan out to the API.
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.load(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Forces a reload. Called when a source returns a CAPABILITY error, which means the
   * planner acted on a stale descriptor — the fix is to refetch and replan once, never to
   * retry the same call blindly.
   */
  async invalidate(): Promise<Registry> {
    this.current = { ...this.current, loadedAt: 0 };
    return this.get();
  }

  private async load(now: number): Promise<Registry> {
    const sources: DataSourceDescriptor[] = [];
    const invalid: Array<{ key: string; problem: string }> = [];

    try {
      let offset = 0;
      for (;;) {
        const page = await this.port.query<unknown>(CO.datasources, { limit: 100, offset });
        for (const entry of page.results) {
          const parsed = dataSourceDescriptorSchema.safeParse(entry.value);
          if (parsed.success) {
            sources.push(parsed.data);
          } else {
            const problem = parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ');
            invalid.push({ key: entry.key, problem });
            this.log.warn('ignoring invalid data-source descriptor', {
              sourceId: entry.key,
              problem,
            });
          }
        }
        if (page.results.length < 100) break;
        offset += page.results.length;
      }
    } catch (error) {
      // A registry read failure must not take the gateway down. Serve the last known good
      // registry and say so, rather than 500ing every report.
      this.log.error('failed to load the data-source registry; serving the previous snapshot', {
        error: error instanceof Error ? error.message : String(error),
        knownSources: this.current.sources.length,
      });
      return this.current;
    }

    this.current = { sources, loadedAt: now, invalid };
    this.log.info('data-source registry loaded', {
      sources: sources.map((s) => `${s.sourceId}@${s.connector.version}`),
      invalid: invalid.length,
    });
    return this.current;
  }
}

/**
 * Timezone drift check.
 *
 * commercetools is UTC; a GA4 property cuts days in its own configured timezone; a
 * warehouse has its own date semantics. If they disagree, cross-source day-grain reports
 * are subtly wrong — so this surfaces LOUDLY in the admin UI rather than quietly producing
 * bad charts.
 */
export const timezoneDrift = (
  sources: DataSourceDescriptor[]
): { consistent: boolean; byTimezone: Record<string, string[]> } => {
  const byTimezone: Record<string, string[]> = {};
  for (const source of sources) {
    const tz = source.capabilities.timezone;
    byTimezone[tz] = [...(byTimezone[tz] ?? []), source.sourceId];
  }
  return { consistent: Object.keys(byTimezone).length <= 1, byTimezone };
};
