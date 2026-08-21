import type { CustomObjectPort } from './shared/ct/ports.js';
import { addDays } from './shared/util/date-range.js';

/**
 * Pure planning of the extract windows.
 *
 * ERP APIs are slow and rate-limited, so the extract runs nightly and is CHUNK-BOUNDED and
 * resumable: it walks the lookback window one day-slice at a time, writing each slice's facts
 * to a Custom Object, so a run that hits the job's 30-minute wall clock resumes from where it
 * stopped instead of restarting.
 */

export interface ExtractSlice {
  date: string;
  container: string;
  key: string;
}

export const EXTRACT_CONTAINER = 'reporting.facts.erp-daily';

export const planSlices = (today: string, lookbackDays: number): ExtractSlice[] => {
  const slices: ExtractSlice[] = [];
  for (let i = 1; i <= lookbackDays; i += 1) {
    const date = addDays(today, -i);
    slices.push({ date, container: EXTRACT_CONTAINER, key: date });
  }
  return slices;
};

/** Whether a slice is already extracted, so a resumed run skips finished days. */
export const isSliceDone = async (
  port: CustomObjectPort,
  slice: ExtractSlice,
  epoch: string
): Promise<boolean> => {
  const existing = await port.get<{ epoch?: string }>(slice.container, slice.key);
  return existing?.value.epoch === epoch;
};
