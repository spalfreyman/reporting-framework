import { describe, expect, it } from 'vitest';
import { planPrewarm, toSourceQuery } from '../src/prewarm.js';

describe('prewarm planning', () => {
  it('plans the common windows and dimension splits', () => {
    const targets = planPrewarm('2026-08-21', 90);
    // 5 combos × 3 windows = 15.
    expect(targets).toHaveLength(15);
    expect(targets.some((t) => t.dimensions.includes('trafficChannel'))).toBe(true);
    expect(targets.every((t) => t.grain === 'day')).toBe(true);
  });

  it('skips windows longer than the configured lookback', () => {
    const targets = planPrewarm('2026-08-21', 28);
    // 90-day window is excluded → 5 combos × 2 windows = 10.
    expect(targets).toHaveLength(10);
    expect(targets.every((t) => t.timeRange.from >= '2026-07-24')).toBe(true);
  });

  it('builds an unrestricted source query with a stable request id', () => {
    const target = planPrewarm('2026-08-21', 7)[0];
    const q = toSourceQuery('sp-demo', 'ga4', target, 'prewarm-1');
    expect(q.scope.unrestricted).toBe(true);
    expect(q.protocolVersion).toBe(1);
    expect(q.requestId).toBe('prewarm-1');
  });
});
