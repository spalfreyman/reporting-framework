/**
 * Chart theme derived from UI Kit design tokens.
 *
 * Colours are read from the UI Kit CSS custom properties at runtime, so charts follow the
 * Merchant Center theme (including any recolouring) instead of hardcoding hexes — which is
 * exactly the mistake to avoid. Semantic colours (positive/negative) are never reused for
 * categorical series.
 */

export interface ChartTheme {
  palette: string[];
  sequential: [string, string];
  diverging: [string, string, string];
  positive: string;
  negative: string;
  neutral: string;
  axisLine: string;
  axisLabel: string;
  splitLine: string;
  textPrimary: string;
  textSecondary: string;
  tooltipBg: string;
}

/** Reads a CSS custom property, falling back when unavailable (e.g. jsdom in tests). */
const token = (name: string, fallback: string): string => {
  if (typeof document === 'undefined' || !document.documentElement)
    return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

/**
 * The categorical palette is ordered so adjacent series are maximally distinguishable and
 * the first few survive greyscale. Every value comes from a UI Kit token, with a sensible
 * literal fallback so charts still render if a token is missing.
 */
export const readChartTheme = (): ChartTheme => ({
  palette: [
    token('--color-primary', '#3f8a4f'),
    token('--color-accent-40', '#617d8f'),
    token('--color-purple-50', '#7c5cbf'),
    token('--color-info-50', '#2c6fbb'),
    token('--color-brown-50', '#8a6d3b'),
    token('--color-accent-60', '#8fa8b8'),
    token('--color-purple-70', '#a98fd6'),
    token('--color-info-60', '#5b93cf'),
  ],
  sequential: [
    token('--color-primary-95', '#e6f2e9'),
    token('--color-primary-25', '#1f5b2e'),
  ],
  diverging: [
    token('--color-error-40', '#b12525'),
    token('--color-neutral-95', '#f2f2f2'),
    token('--color-primary-25', '#1f5b2e'),
  ],
  positive: token('--color-primary', '#3f8a4f'),
  negative: token('--color-error', '#b12525'),
  neutral: token('--color-neutral-50', '#8f8f8f'),
  axisLine: token('--color-neutral-90', '#d4d4d4'),
  axisLabel: token('--color-neutral-40', '#666666'),
  splitLine: token('--color-neutral-95', '#efefef'),
  textPrimary: token('--color-solid', '#1a1a1a'),
  textSecondary: token('--color-neutral-40', '#666666'),
  tooltipBg: token('--color-surface', '#ffffff'),
});
