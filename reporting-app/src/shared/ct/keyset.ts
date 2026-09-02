import { CO } from '../schema/descriptor';
import type { CustomObjectPort, OrderScanPort } from './ports';
import type { JobCursor } from '../rollup/keying';

/**
 * Keyset pagination and cursor checkpointing.
 *
 * NEVER `offset`. The platform caps offset at 10,000, and `total` is capped at the max
 * offset for predicated queries, so an offset walk silently truncates real order history
 * rather than failing. Keyset pagination on (lastModifiedAt, id) has no depth limit and the
 * cursor doubles as the resume point.
 */

/**
 * The exact predicate, sort and input variables an adapter should issue.
 *
 * Returning the variables alongside the predicate keeps the two from drifting. Passing
 * values as `var.*` inputs rather than interpolating them also keeps the query string short,
 * which matters because request URL + headers are capped at roughly 15 KB.
 */
export const keysetPredicate = (
  afterLastModifiedAt: string | null,
  afterId: string | null,
  until: string
): { where: string; sort: string[]; vars: Record<string, string> } => {
  const upper = 'lastModifiedAt < :until';
  const resuming = Boolean(afterLastModifiedAt && afterId);
  const where = resuming
    ? `(lastModifiedAt > :ts or (lastModifiedAt = :ts and id > :id)) and ${upper}`
    : upper;
  const vars: Record<string, string> = { until };
  if (resuming) {
    vars.ts = afterLastModifiedAt as string;
    vars.id = afterId as string;
  }
  return { where, sort: ['lastModifiedAt asc', 'id asc'], vars };
};

/**
 * Each sweep stops slightly short of "now" so a write that is still settling is not missed
 * and then skipped forever. The next run picks up the tail.
 */
export const safeUpperBound = (now: Date, lagSeconds = 120): string =>
  new Date(now.getTime() - lagSeconds * 1000).toISOString();

export const loadCursor = async (
  port: CustomObjectPort,
  jobName: string
): Promise<JobCursor | null> => {
  const existing = await port.get<JobCursor>(CO.cursors, jobName);
  return existing?.value ?? null;
};

export const saveCursor = async (
  port: CustomObjectPort,
  jobName: string,
  cursor: JobCursor
): Promise<void> => {
  const existing = await port.get<JobCursor>(CO.cursors, jobName);
  await port.put<JobCursor>(CO.cursors, jobName, cursor, existing?.version);
};

export interface ScannedItem {
  id: string;
  lastModifiedAt: string;
}

export interface ScanOptions {
  jobName: string;
  pageSize: number;
  until: string;
  /** Stop when this returns true — the wall-clock budget guard. */
  exhausted: () => boolean;
  now: () => Date;
}

export interface ScanOutcome {
  processed: number;
  pages: number;
  /** True when the budget ran out mid-scan, so the next run should resume. */
  incomplete: boolean;
  cursor: JobCursor;
}

/**
 * Walks a resource with keyset pagination, invoking `handle` per page and checkpointing the
 * cursor after each one — so a timeout or crash loses at most one page of work.
 */
export const scanWithCheckpoint = async <T extends ScannedItem>(
  scanner: OrderScanPort<T>,
  port: CustomObjectPort,
  options: ScanOptions,
  handle: (batch: T[]) => Promise<void>
): Promise<ScanOutcome> => {
  const { jobName, pageSize, until, exhausted, now } = options;

  const existing = await loadCursor(port, jobName);
  let cursor: JobCursor = existing ?? {
    phase: 'fold',
    lastModifiedAt: '',
    lastId: '',
    progress: { processed: 0 },
    epoch: 0,
    updatedAt: now().toISOString(),
  };

  let processed = 0;
  let pages = 0;
  let incomplete = false;

  for (;;) {
    if (exhausted()) {
      incomplete = true;
      break;
    }

    const page = await scanner.scan({
      afterLastModifiedAt: cursor.lastModifiedAt || null,
      afterId: cursor.lastId || null,
      until,
      limit: pageSize,
    });

    if (page.results.length === 0) break;

    await handle(page.results);

    const last = page.results[page.results.length - 1];
    cursor = {
      ...cursor,
      lastModifiedAt: last.lastModifiedAt,
      lastId: last.id,
      progress: { processed: cursor.progress.processed + page.results.length },
      updatedAt: now().toISOString(),
    };
    await saveCursor(port, jobName, cursor);

    processed += page.results.length;
    pages += 1;

    // A short page means we have caught up to the upper bound.
    if (page.results.length < pageSize) break;
  }

  return { processed, pages, incomplete, cursor };
};
