import type { EChartsOption } from './register-echarts';
import type { ChartTheme } from './theme';

/**
 * Shared option defaults every renderer starts from.
 *
 * Two things here are not cosmetic:
 *  - `aria.enabled` makes ECharts emit a text description of the chart, and `decal` overlays
 *    pattern fills so categorical series stay distinguishable without colour. Canvas charts
 *    are otherwise invisible to assistive tech and to colour-blind viewers.
 *  - `animation` is disabled under prefers-reduced-motion.
 */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const baseOption = (theme: ChartTheme): EChartsOption => ({
  color: theme.palette,
  animation: !prefersReducedMotion(),
  textStyle: { color: theme.textPrimary, fontFamily: 'inherit' },
  aria: { enabled: true, decal: { show: true } },
  grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
  tooltip: {
    trigger: 'item',
    backgroundColor: theme.tooltipBg,
    borderColor: theme.axisLine,
    textStyle: { color: theme.textPrimary },
    confine: true,
  },
  legend: {
    show: false,
    textStyle: { color: theme.textSecondary },
    type: 'scroll',
    top: 0,
  },
});

/** A categorical axis styled from the theme. */
export const categoryAxis = (theme: ChartTheme) => ({
  type: 'category' as const,
  axisLine: { lineStyle: { color: theme.axisLine } },
  axisLabel: { color: theme.axisLabel, hideOverlap: true },
  axisTick: { show: false },
});

/** A value axis styled from the theme. `formatter` receives the raw number. */
export const valueAxis = (
  theme: ChartTheme,
  formatter?: (value: number) => string,
  opts: { zero?: boolean } = {}
) => ({
  type: 'value' as const,
  scale: opts.zero !== true,
  axisLine: { show: false },
  axisLabel: {
    color: theme.axisLabel,
    ...(formatter ? { formatter: (v: number) => formatter(v) } : {}),
  },
  splitLine: { lineStyle: { color: theme.splitLine } },
});
