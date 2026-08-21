import {
  distinctValues,
  toCategorical,
  toMatrix,
  toTimeSeries,
} from './adapters/shape';
import { pivot, isAdditiveColumn } from './adapters/pivot';
import { buildTimeSeriesOption } from './renderers/time-series';
import { buildBreakdownOption } from './renderers/breakdown';
import { buildFunnelOption } from './renderers/funnel';
import { buildHeatmapOption } from './renderers/cohort-heatmap';
import { readChartTheme } from './echarts-base/theme';
import type { ChartSpec } from '../../shared/schema/chart-spec';
import type { ColumnMeta } from '../../shared/schema/query';
import type { Row } from '../../types/reporting';

/**
 * Charts are tested at the pure `buildOption` seam, not through a canvas. Each renderer maps
 * a ChartSpec + tidy rows to an ECharts option object; that mapping is where the bugs live,
 * so it is what the tests exercise. The React wrapper is trivial and canvas-only.
 */

const theme = readChartTheme();
const labelOf = (id: string) => id;
const fmt = () => (v: number) => String(v);

const spec = (over: Partial<ChartSpec>): ChartSpec =>
  ({
    specVersion: 1,
    type: 'timeseries',
    encoding: {},
    options: {},
    ...over,
  } as ChartSpec);

// ── shape adapters ────────────────────────────────────────────────────────────

describe('shape adapters', () => {
  it('sorts a time series by x and drops missing points rather than zero-filling', () => {
    const rows: Row[] = [
      { date: '2026-08-03', revenue: 30 },
      { date: '2026-08-01', revenue: 10 },
      { date: '2026-08-02', revenue: null }, // a gap, not a zero
    ];
    const series = toTimeSeries(rows, 'date', 'revenue');
    expect(series).toEqual([
      ['2026-08-01', 10],
      ['2026-08-03', 30],
    ]);
  });

  it('ranks a categorical breakdown descending and honours topN', () => {
    const rows: Row[] = [
      { channel: 'web', revenue: 100 },
      { channel: 'retail', revenue: 40 },
      { channel: 'app', revenue: 70 },
    ];
    expect(toCategorical(rows, 'channel', 'revenue', 2)).toEqual([
      { name: 'web', value: 100 },
      { name: 'app', value: 70 },
    ]);
  });

  it('keeps distinct values in first-seen order', () => {
    const rows: Row[] = [{ c: 'b' }, { c: 'a' }, { c: 'b' }, { c: 'c' }];
    expect(distinctValues(rows, 'c')).toEqual(['b', 'a', 'c']);
  });

  it('omits missing matrix cells so a heatmap leaves them blank', () => {
    // Cohort 2026-06 has no period-2 value; it must NOT appear as a zero point.
    const rows: Row[] = [
      { cohort: '2026-06', period: '0', v: 100 },
      { cohort: '2026-06', period: '1', v: 40 },
      { cohort: '2026-07', period: '0', v: 80 },
    ];
    const { rowKeys, colKeys, points } = toMatrix(
      rows,
      'cohort',
      'period',
      'v'
    );
    expect(rowKeys).toEqual(['2026-06', '2026-07']);
    expect(colKeys).toEqual(['0', '1']);
    // 3 real points only — the (2026-07, period 1) cell is absent, not zero.
    expect(points).toHaveLength(3);
    expect(points).not.toContainEqual([1, 1, 0]);
  });
});

// ── time series ─────────────────────────────────────────────────────────────

describe('time series option', () => {
  const columns: ColumnMeta[] = [
    {
      id: 'date',
      role: 'time',
      valueType: 'time',
      exactness: 'exact',
      nullMeaning: 'unknown',
    },
    {
      id: 'revenue.net@orderdate',
      role: 'metric',
      valueType: 'money',
      exactness: 'exact',
      nullMeaning: 'zero',
    },
    {
      id: 'orders.count@orderdate',
      role: 'metric',
      valueType: 'count',
      exactness: 'exact',
      nullMeaning: 'zero',
    },
  ];
  const rows: Row[] = [
    {
      date: '2026-08-01',
      'revenue.net@orderdate': 1000,
      'orders.count@orderdate': 10,
    },
    {
      date: '2026-08-02',
      'revenue.net@orderdate': 1500,
      'orders.count@orderdate': 12,
    },
  ];

  it('builds one series per y field, aligned to a shared sorted x axis', () => {
    const option = buildTimeSeriesOption({
      spec: spec({
        type: 'timeseries',
        encoding: {
          x: { field: 'date', from: 'primary' },
          y: [
            { field: 'revenue.net@orderdate', from: 'primary' },
            { field: 'orders.count@orderdate', from: 'primary' },
          ],
        },
      }),
      columns,
      rows,
      theme,
      labelOf,
      formatterFor: fmt,
    }) as { xAxis: { data: string[] }; series: unknown[] };

    expect(option.xAxis.data).toEqual(['2026-08-01', '2026-08-02']);
    expect(option.series).toHaveLength(2);
  });

  it('puts a right-axis series on yAxisIndex 1 when dual-axis', () => {
    const option = buildTimeSeriesOption({
      spec: spec({
        type: 'timeseries',
        options: { dualAxis: true },
        encoding: {
          x: { field: 'date', from: 'primary' },
          y: [
            { field: 'revenue.net@orderdate', axis: 'left', from: 'primary' },
            { field: 'orders.count@orderdate', axis: 'right', from: 'primary' },
          ],
        },
      }),
      columns,
      rows,
      theme,
      labelOf,
      formatterFor: fmt,
    }) as { yAxis: unknown[]; series: Array<{ yAxisIndex: number }> };

    expect(Array.isArray(option.yAxis)).toBe(true);
    expect(option.series[1].yAxisIndex).toBe(1);
  });

  it('adds a dashed ghost series for the comparison period when asked', () => {
    const option = buildTimeSeriesOption({
      spec: spec({
        type: 'timeseries',
        options: { showComparisonGhost: true },
        encoding: {
          x: { field: 'date', from: 'primary' },
          y: [{ field: 'revenue.net@orderdate', from: 'primary' }],
        },
      }),
      columns,
      rows,
      comparison: {
        rows: [{ date: '2026-08-01', 'revenue.net@orderdate': 800 }],
      },
      theme,
      labelOf,
      formatterFor: fmt,
    }) as { series: Array<{ lineStyle?: { type?: string } }> };

    expect(option.series).toHaveLength(2);
    expect(option.series[1].lineStyle?.type).toBe('dashed');
  });
});

// ── breakdown ─────────────────────────────────────────────────────────────────

describe('breakdown option', () => {
  const columns: ColumnMeta[] = [
    {
      id: 'channel',
      role: 'dimension',
      valueType: 'string',
      exactness: 'exact',
      nullMeaning: 'unknown',
    },
    {
      id: 'revenue.net@orderdate',
      role: 'metric',
      valueType: 'money',
      exactness: 'exact',
      nullMeaning: 'zero',
    },
  ];
  const rows: Row[] = [
    { channel: 'web', 'revenue.net@orderdate': 100 },
    { channel: 'retail', 'revenue.net@orderdate': 40 },
  ];
  const base = {
    columns,
    rows,
    theme,
    categoryLabel: 'Channel',
    labelOf,
    formatterFor: fmt,
  };

  it('caps a donut at maxSlices', () => {
    const many: Row[] = Array.from({ length: 12 }, (_, i) => ({
      channel: `c${i}`,
      'revenue.net@orderdate': 12 - i,
    }));
    const option = buildBreakdownOption({
      ...base,
      rows: many,
      type: 'donut',
      spec: spec({
        type: 'donut',
        options: { maxSlices: 5 },
        encoding: {
          category: { field: 'channel', from: 'primary' },
          value: { field: 'revenue.net@orderdate', from: 'primary' },
        },
      }),
    }) as { series: Array<{ data: unknown[] }> };
    expect(option.series[0].data).toHaveLength(5);
  });

  it('normalises a 100% stacked bar to column shares', () => {
    const option = buildBreakdownOption({
      ...base,
      type: 'breakdown',
      spec: spec({
        type: 'breakdown',
        options: { stacked: true, normalise: true },
        encoding: {
          category: { field: 'channel', from: 'primary' },
          y: [{ field: 'revenue.net@orderdate', from: 'primary' }],
        },
      }),
    }) as { series: Array<{ data: number[] }> };
    // Single series normalised against itself → every bar is 1.
    for (const v of option.series[0].data) expect(v).toBeCloseTo(1);
  });
});

// ── funnel ─────────────────────────────────────────────────────────────────────

describe('funnel option', () => {
  it('orders steps by the metric totals and drops missing steps', () => {
    const option = buildFunnelOption({
      spec: spec({
        type: 'funnel',
        encoding: {
          steps: [
            'sessions.count',
            'addtocart.count',
            'orders.count@orderdate',
          ],
        },
      }),
      totals: {
        'sessions.count': 1000,
        'addtocart.count': 120,
        'orders.count@orderdate': 40,
      },
      theme,
      labelOf,
    }) as { series: Array<{ data: Array<{ value: number }> }> };
    expect(option.series[0].data.map((d) => d.value)).toEqual([1000, 120, 40]);
  });
});

// ── cohort heatmap ──────────────────────────────────────────────────────────

describe('cohort heatmap option', () => {
  it('emits only real points, leaving future cohort periods blank', () => {
    const columns: ColumnMeta[] = [
      {
        id: 'cohortMonth',
        role: 'dimension',
        valueType: 'string',
        exactness: 'exact',
        nullMeaning: 'unknown',
      },
      {
        id: 'periodIndex',
        role: 'dimension',
        valueType: 'string',
        exactness: 'exact',
        nullMeaning: 'unknown',
      },
      {
        id: 'retention.rate',
        role: 'metric',
        valueType: 'percent',
        exactness: 'exact',
        nullMeaning: 'unknown',
      },
    ];
    const rows: Row[] = [
      { cohortMonth: '2026-06', periodIndex: '0', 'retention.rate': 1 },
      { cohortMonth: '2026-06', periodIndex: '1', 'retention.rate': 0.4 },
      { cohortMonth: '2026-07', periodIndex: '0', 'retention.rate': 1 },
    ];
    const option = buildHeatmapOption({
      spec: spec({
        type: 'heatmap',
        encoding: {
          row: { field: 'cohortMonth', from: 'primary' },
          column: { field: 'periodIndex', from: 'primary' },
          value: { field: 'retention.rate', from: 'primary' },
        },
      }),
      columns,
      rows,
      theme,
      rowLabel: 'Cohort',
      colLabel: 'Period',
      formatValue: (v) => String(v),
    }) as { series: Array<{ data: number[][] }> };
    expect(option.series[0].data).toHaveLength(3);
  });
});

// ── pivot ─────────────────────────────────────────────────────────────────────

describe('pivot adapter', () => {
  const rows: Row[] = [
    { category: 'shoes', month: '2026-07', revenue: 100 },
    { category: 'shoes', month: '2026-08', revenue: 150 },
    { category: 'bags', month: '2026-07', revenue: 60 },
  ];

  it('pivots into a rows × columns grid with additive subtotals', () => {
    const p = pivot(rows, 'category', 'month', 'revenue', true);
    expect(p.rowKeys).toEqual(['shoes', 'bags']);
    expect(p.colKeys).toEqual(['2026-07', '2026-08']);
    expect(p.cell.shoes['2026-08']).toBe(150);
    expect(p.rowTotals.shoes).toBe(250);
    expect(p.colTotals['2026-07']).toBe(160);
    expect(p.grandTotal).toBe(310);
  });

  it('refuses to subtotal a non-additive measure', () => {
    // A ratio must not be summed into a meaningless total.
    const p = pivot(rows, 'category', 'month', 'revenue', false);
    expect(p.rowTotals.shoes).toBeNull();
    expect(p.grandTotal).toBeNull();
  });

  it('classifies additive column types', () => {
    const money: ColumnMeta = {
      id: 'r',
      role: 'metric',
      valueType: 'money',
      exactness: 'exact',
      nullMeaning: 'zero',
    };
    const ratio: ColumnMeta = {
      id: 'x',
      role: 'metric',
      valueType: 'percent',
      exactness: 'exact',
      nullMeaning: 'unknown',
    };
    expect(isAdditiveColumn(money)).toBe(true);
    expect(isAdditiveColumn(ratio)).toBe(false);
  });

  it('leaves an absent pivot cell null, not zero', () => {
    const p = pivot(rows, 'category', 'month', 'revenue', true);
    // bags has no August figure.
    expect(p.cell.bags['2026-08']).toBeNull();
  });
});
