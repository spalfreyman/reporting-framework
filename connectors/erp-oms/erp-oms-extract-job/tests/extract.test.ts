import { describe, expect, it } from 'vitest';
import { planSlices, EXTRACT_CONTAINER } from '../src/extract.js';

describe('erp extract planning', () => {
  it('plans one resumable slice per lookback day, all in the past', () => {
    const slices = planSlices('2026-08-21', 90);
    expect(slices).toHaveLength(90);
    // Day-keyed so a resumed run can skip finished days.
    expect(slices[0].key).toBe('2026-08-20');
    expect(slices.every((s) => s.container === EXTRACT_CONTAINER)).toBe(true);
    expect(slices.every((s) => s.date < '2026-08-21')).toBe(true);
  });

  it('scales with the lookback window', () => {
    expect(planSlices('2026-08-21', 7)).toHaveLength(7);
  });
});
