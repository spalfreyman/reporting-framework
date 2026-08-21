import { useMemo } from 'react';
import {
  validateEncodedFields,
  type Renderer,
  type RendererProps,
} from '../types';
import type { ChartSpec } from '../../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../../shared/schema/query';

/**
 * A micro-trend, drawn as a single inline SVG path.
 *
 * Roughly a kilobyte and no dependency, which is the whole point: a sparkline inside a KPI
 * tile should not drag in a charting library.
 */
const Sparkline = ({ spec, rows, height }: RendererProps) => {
  const field = spec.encoding.trend?.field ?? spec.encoding.value?.field;

  const path = useMemo(() => {
    if (!field) return null;
    const values = rows
      .map((row) => row[field])
      .filter((value): value is number => typeof value === 'number');
    if (values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const width = 120;
    const usableHeight = Math.max(16, height);

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        // SVG y grows downward, so invert.
        const y = usableHeight - ((value - min) / span) * usableHeight;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [field, rows, height]);

  if (!path) return null;

  return (
    <svg
      width="120"
      height={Math.max(16, height)}
      viewBox={`0 0 120 ${Math.max(16, height)}`}
      // Decorative: the figure it accompanies carries the meaning, and the tile's
      // "view as table" toggle carries the data.
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
Sparkline.displayName = 'Sparkline';

const renderer: Renderer = {
  capabilities: {
    type: 'sparkline',
    requires: [],
    supportsOptions: [],
    supportsComparison: false,
    supportsDrilldown: false,
    libraryFree: true,
  },
  validate: (spec: ChartSpec, columns: ColumnMeta[]) =>
    validateEncodedFields(spec, columns),
  Component: Sparkline,
};

export default renderer;
