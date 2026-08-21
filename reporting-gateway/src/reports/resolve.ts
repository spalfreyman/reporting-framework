import { CO } from '../shared/schema/descriptor.js';
import { BUILTIN_REPORTS } from '../shared/catalogue/index.js';
import {
  migrateReportDefinition,
  reportDefinitionSchema,
  type ReportDefinition,
} from '../shared/schema/report-definition.js';
import type { CustomObjectPort } from '../shared/ct/ports.js';
import type { Logger } from '../logger.js';

/**
 * Report resolution: built-ins from code, plus user-created reports from Custom Objects.
 *
 * A stored report with the same id shadows the built-in, so a customer can override a
 * shipped report without forking it — and the built-in is never lost.
 *
 * Migrations run LAZILY on read, so definitions written by an older connector version keep
 * working. A definition from a NEWER version is refused rather than guessed at.
 */

export interface ResolvedReports {
  reports: ReportDefinition[];
  byId: Record<string, ReportDefinition>;
  problems: Array<{ id: string; problem: string }>;
}

export const resolveReports = async (
  port: CustomObjectPort,
  log: Logger
): Promise<ResolvedReports> => {
  const byId: Record<string, ReportDefinition> = { ...BUILTIN_REPORTS };
  const problems: Array<{ id: string; problem: string }> = [];

  try {
    let offset = 0;
    for (;;) {
      const page = await port.query<Record<string, unknown>>(CO.reports, { limit: 100, offset });
      for (const entry of page.results) {
        try {
          const migrated = migrateReportDefinition(entry.value);
          const parsed = reportDefinitionSchema.parse(migrated);
          byId[parsed.id] = parsed;
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error);
          problems.push({ id: entry.key, problem });
          log.warn('ignoring invalid stored report definition', { reportId: entry.key, problem });
        }
      }
      if (page.results.length < 100) break;
      offset += page.results.length;
    }
  } catch (error) {
    // Custom-object reports being unreadable must not hide the built-in catalogue.
    log.error('could not read stored report definitions; serving built-ins only', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { reports: Object.values(byId), byId, problems };
};
