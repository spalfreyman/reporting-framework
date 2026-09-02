import { randomUUID } from 'node:crypto';
import { readConfiguration } from './env.js';
import { createLogger } from './logger.js';
import { getCustomObjectPort, getOrderScanPort } from './client.js';
import { foldDay } from './fold.js';
import {
  createBudget,
  loadCursor,
  saveCursor,
  safeUpperBound,
  withJobLock,
} from './shared/ct/index.js';
import { CO } from './shared/schema/descriptor.js';
import { orderFactContainerFor } from './shared/rollup/keying.js';
import { toOrderFact, type OrderProjection } from './shared/rollup/order-mapping.js';
import { ConcurrentModificationError } from './shared/ct/ports.js';
import type { OrderFact } from './shared/rollup/keying.js';
import type { CustomObjectPort } from './shared/ct/ports.js';
import type { ScannedOrder } from './shared-node/ct-adapter.js';

/**
 * The rollup job.
 *
 * One coherent pass, resumable and lock-guarded:
 *   1. Take the job lock (Connect has no concurrency guard; overlap would double-process).
 *   2. Scan orders changed since the cursor, by keyset on (lastModifiedAt, id) — NEVER
 *      offset, which the platform caps at 10,000 and which would silently truncate history.
 *   3. Write one fact per order (CAS on orderVersion; redelivery and reorder are no-ops).
 *   4. Rebuild every dirty day's partitions from its facts.
 *   5. Checkpoint the cursor; stop before the budget runs out and resume next run.
 *
 * Connect triggers this by POSTing to the app's endpoint on the cron schedule; the HTTP
 * wrapper in app.ts calls runJob and always replies 200. runJob itself never touches the
 * process lifecycle, so it stays trivially unit-testable.
 */

export const JOB_NAME = 'reporting-rollup-job';

/** Upsert a per-order fact, letting a newer version win a concurrent write. */
const writeOrderFact = async (
  port: CustomObjectPort,
  fact: OrderFact
): Promise<void> => {
  const container = orderFactContainerFor(fact.businessDate);
  const existing = await port.get<OrderFact>(container, fact.orderId);

  // Monotonic guard: a stale redelivery must not overwrite a newer fact.
  if (existing && existing.value.orderVersion >= fact.orderVersion) return;

  try {
    await port.put(container, fact.orderId, fact, existing?.version);
  } catch (error) {
    // Lost a race to a concurrent writer — the winner had a version too, so it is safe to
    // drop this write rather than clobber it.
    if (!(error instanceof ConcurrentModificationError)) throw error;
  }
};

const readEpoch = async (port: CustomObjectPort): Promise<number> => {
  const epoch = await port.get<{ restatementEpoch?: number }>(CO.config, CO.keys.epoch);
  return epoch?.value.restatementEpoch ?? 1;
};

export const runJob = async (deps?: {
  port?: CustomObjectPort;
  scanner?: ReturnType<typeof getOrderScanPort>;
  now?: () => Date;
}): Promise<{ skipped: boolean; ordersProcessed: number; daysFolded: number }> => {
  const config = readConfiguration();
  const now = deps?.now ?? (() => new Date());
  const runId = randomUUID();
  const log = createLogger(config.LOG_LEVEL, { app: JOB_NAME, runId });
  const port = deps?.port ?? getCustomObjectPort();
  const scanner = deps?.scanner ?? getOrderScanPort();

  const outcome = await withJobLock(
    port,
    { jobName: JOB_NAME, runId, ttlMs: config.ROLLUP_LOCK_TTL_MS, now },
    async () => {
      const budget = createBudget(config.ROLLUP_BUDGET_MS, () => now().getTime());
      const cubes = config.ROLLUP_CUBES.split(',').map((c) => c.trim()).filter(Boolean);
      const restatementEpoch = await readEpoch(port);

      const cursor = (await loadCursor(port, JOB_NAME)) ?? {
        phase: 'backfill' as const,
        lastModifiedAt: '',
        lastId: '',
        progress: { processed: 0 },
        epoch: restatementEpoch,
        updatedAt: now().toISOString(),
      };

      const until = safeUpperBound(now(), config.ROLLUP_SAFE_LAG_SECONDS);
      const dirtyDays = new Set<string>();
      let ordersProcessed = 0;
      let scanComplete = false;
      let pageCursor = { lastModifiedAt: cursor.lastModifiedAt, lastId: cursor.lastId };

      // ── Scan orders and write facts ────────────────────────────────────────
      for (;;) {
        if (budget.exhausted()) {
          log.warn('budget exhausted; checkpointing and exiting to resume next run', {
            processed: ordersProcessed,
          });
          break;
        }

        const page = await scanner.scan({
          afterLastModifiedAt: pageCursor.lastModifiedAt || null,
          afterId: pageCursor.lastId || null,
          until,
          limit: config.ROLLUP_PAGE_SIZE,
        });

        if (page.results.length === 0) {
          scanComplete = true;
          break;
        }

        for (const scanned of page.results) {
          const fact = toOrderFact(scanned as unknown as OrderProjection, config.ROLLUP_TIMEZONE);
          await writeOrderFact(port, fact);
          dirtyDays.add(fact.businessDate);
          ordersProcessed += 1;
        }

        const last = page.results[page.results.length - 1] as ScannedOrder;
        pageCursor = { lastModifiedAt: last.lastModifiedAt, lastId: last.id };
        await saveCursor(port, JOB_NAME, {
          ...cursor,
          phase: 'fold',
          lastModifiedAt: pageCursor.lastModifiedAt,
          lastId: pageCursor.lastId,
          progress: { processed: cursor.progress.processed + ordersProcessed },
          epoch: restatementEpoch,
          updatedAt: now().toISOString(),
        });

        if (page.results.length < config.ROLLUP_PAGE_SIZE) {
          scanComplete = true;
          break;
        }
      }

      log.info('order scan complete', { ordersProcessed, dirtyDays: dirtyDays.size, scanComplete });

      // ── Rebuild dirty days ─────────────────────────────────────────────────
      let daysFolded = 0;
      for (const day of dirtyDays) {
        if (budget.exhausted()) {
          log.warn('budget exhausted during fold; remaining days resume next run', {
            folded: daysFolded,
            remaining: dirtyDays.size - daysFolded,
          });
          break;
        }
        await foldDay(
          port,
          day,
          { cubes, timezone: config.ROLLUP_TIMEZONE, restatementEpoch, itemTopN: config.ITEM_TOP_N, now: now() },
          log
        );
        daysFolded += 1;
      }

      // Advance the watermark ONLY when the scan reached the end. That is what licenses the
      // strong claim behind it: every order modified up to `until` has been folded, so a
      // reader can treat any missing partition on or before `until` as genuine zero trade
      // rather than "not yet materialized". A budget-truncated run makes no such claim.
      if (scanComplete) {
        const throughDate = until.slice(0, 10);
        const existing = await port.get<{ throughDate?: string }>(
          CO.config,
          CO.keys.rollupWatermark
        );
        const kept =
          existing?.value.throughDate && existing.value.throughDate > throughDate
            ? existing.value.throughDate
            : throughDate;
        await port.put(
          CO.config,
          CO.keys.rollupWatermark,
          { throughDate: kept, builtAt: now().toISOString() },
          existing?.version
        );
        log.info('watermark advanced', { throughDate: kept });
      }

      log.info('rollup run complete', { ordersProcessed, daysFolded, scanComplete });
      return { ordersProcessed, daysFolded };
    }
  );

  if (outcome.skipped) {
    log.warn('another run holds the lock; exiting without doing work');
    return { skipped: true, ordersProcessed: 0, daysFolded: 0 };
  }
  return { skipped: false, ...outcome.result };
};
