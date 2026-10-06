import { CO } from '../schema/descriptor';
import { ConcurrentModificationError, type CustomObjectPort } from './ports';
import type { JobLock } from '../rollup/keying';

/**
 * A durable job lock in a Custom Object.
 *
 * Connect provides NO concurrency guard for jobs: a run that exceeds its cron interval will
 * happily overlap the next tick. This is the only thing standing between that and
 * double-processing.
 *
 * The TTL must exceed the 30-minute job timeout, so a crashed run's lock expires on its own
 * rather than wedging the job forever.
 */

export interface LockHandle {
  jobName: string;
  runId: string;
  version: number;
}

export interface AcquireOptions {
  jobName: string;
  runId: string;
  ttlMs: number;
  /** Injected so this is deterministic in tests. */
  now: () => Date;
}

export const acquireLock = async (
  port: CustomObjectPort,
  { jobName, runId, ttlMs, now }: AcquireOptions
): Promise<LockHandle | null> => {
  const current = now();
  const existing = await port.get<JobLock>(CO.locks, jobName);

  if (existing) {
    const expiresAt = Date.parse(existing.value.expiresAt);
    // A live lock means another run owns this job. Decline, and let the caller exit 0 —
    // a skipped tick is correct behaviour, not a failure.
    if (Number.isFinite(expiresAt) && expiresAt > current.getTime()) return null;
  }

  const lock: JobLock = {
    owner: jobName,
    runId,
    acquiredAt: current.toISOString(),
    heartbeatAt: current.toISOString(),
    expiresAt: new Date(current.getTime() + ttlMs).toISOString(),
  };

  try {
    // Passing the observed version makes this a compare-and-swap: if another run took the
    // lock between our read and this write, we lose and return null.
    const written = await port.put<JobLock>(CO.locks, jobName, lock, existing?.version);
    return { jobName, runId, version: written.version };
  } catch (error) {
    if (error instanceof ConcurrentModificationError) return null;
    throw error;
  }
};

/** Extends the lock so a long run is not reaped mid-flight. Best-effort by design. */
export const heartbeat = async (
  port: CustomObjectPort,
  handle: LockHandle,
  ttlMs: number,
  now: () => Date
): Promise<LockHandle> => {
  const current = now();
  const existing = await port.get<JobLock>(CO.locks, handle.jobName);
  // Someone else owns it now — stop pretending we hold it.
  if (!existing || existing.value.runId !== handle.runId) return handle;

  const written = await port.put<JobLock>(
    CO.locks,
    handle.jobName,
    {
      ...existing.value,
      heartbeatAt: current.toISOString(),
      expiresAt: new Date(current.getTime() + ttlMs).toISOString(),
    },
    existing.version
  );
  return { ...handle, version: written.version };
};

/** Releases only if we still own it, so we never delete a successor's lock. */
export const releaseLock = async (port: CustomObjectPort, handle: LockHandle): Promise<void> => {
  const existing = await port.get<JobLock>(CO.locks, handle.jobName);
  if (!existing || existing.value.runId !== handle.runId) return;
  await port.delete(CO.locks, handle.jobName);
};

/**
 * Runs `work` under the lock, releasing it even if `work` throws.
 * Returns `{ skipped: true }` when another run holds the lock.
 */
export const withJobLock = async <T>(
  port: CustomObjectPort,
  options: AcquireOptions,
  work: (handle: LockHandle) => Promise<T>
): Promise<{ skipped: true } | { skipped: false; result: T }> => {
  const handle = await acquireLock(port, options);
  if (!handle) return { skipped: true };
  try {
    return { skipped: false, result: await work(handle) };
  } finally {
    await releaseLock(port, handle);
  }
};

/**
 * A wall-clock budget guard.
 *
 * Every job is resumable and chunk-bounded: it works until the budget is spent, checkpoints
 * and exits 0. No run ever *needs* to finish, which is what keeps the hard 30-minute
 * timeout from being a failure mode.
 */
export const createBudget = (budgetMs: number, now: () => number = Date.now) => {
  const startedAt = now();
  return {
    startedAt,
    elapsedMs: () => now() - startedAt,
    exhausted: () => now() - startedAt >= budgetMs,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
  };
};
