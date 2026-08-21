import {
  describeProblems,
  emptyDraft,
  emptyTile,
  toDefinition,
  type DraftReport,
} from './draft-model';
import { reportDefinitionSchema } from '../../shared/schema/report-definition';

/**
 * The draft model is what keeps the builder honest: it can only produce a report the schema
 * accepts, and `describeProblems` catches the mistakes an author would otherwise only find
 * when the tile renders empty. These tests pin both.
 */

const draft = (over: Partial<DraftReport> = {}): DraftReport => ({
  ...emptyDraft(),
  id: 'my-report',
  title: 'My report',
  tiles: [
    {
      id: 'tile-1',
      title: 'Revenue',
      chartType: 'kpi',
      metrics: ['revenue.net@orderdate'],
      dimensions: [],
    },
  ],
  ...over,
});

describe('describeProblems', () => {
  it('passes a well-formed draft', () => {
    expect(describeProblems(draft())).toEqual([]);
  });

  it('requires an id', () => {
    expect(describeProblems(draft({ id: '' }))).toContain(
      'Give the report an id.'
    );
  });

  it('requires each tile to have a metric', () => {
    const problems = describeProblems(draft({ tiles: [emptyTile(1)] }));
    expect(problems.some((p) => /choose at least one metric/.test(p))).toBe(
      true
    );
  });

  it('flags an unknown metric', () => {
    const problems = describeProblems(
      draft({
        tiles: [
          {
            id: 't',
            title: 't',
            chartType: 'kpi',
            metrics: ['not.a.metric'],
            dimensions: [],
          },
        ],
      })
    );
    expect(problems.some((p) => /unknown metric/.test(p))).toBe(true);
  });

  it('requires a dimension for a breakdown', () => {
    const problems = describeProblems(
      draft({
        tiles: [
          {
            id: 't',
            title: 't',
            chartType: 'breakdown',
            metrics: ['revenue.net@orderdate'],
            dimensions: [],
          },
        ],
      })
    );
    expect(problems.some((p) => /needs a dimension/.test(p))).toBe(true);
  });

  it('requires two dimensions for a heatmap and two metrics for a scatter', () => {
    expect(
      describeProblems(
        draft({
          tiles: [
            {
              id: 't',
              title: 't',
              chartType: 'heatmap',
              metrics: ['retention.rate'],
              dimensions: ['cohortMonth'],
            },
          ],
        })
      ).some((p) => /two dimensions/.test(p))
    ).toBe(true);
    expect(
      describeProblems(
        draft({
          tiles: [
            {
              id: 't',
              title: 't',
              chartType: 'scatter',
              metrics: ['units.sold@orderdate'],
              dimensions: ['product'],
            },
          ],
        })
      ).some((p) => /two metrics/.test(p))
    ).toBe(true);
  });
});

describe('toDefinition', () => {
  it('produces a report the schema accepts', () => {
    const definition = toDefinition(draft());
    expect(() => reportDefinitionSchema.parse(definition)).not.toThrow();
    expect(definition.origin).toBe('custom');
  });

  it('namespaces the id under custom.', () => {
    expect(toDefinition(draft({ id: 'my-report' })).id).toBe(
      'custom.my-report'
    );
    // An already-namespaced id is left alone.
    expect(toDefinition(draft({ id: 'custom.keep' })).id).toBe('custom.keep');
  });

  it('lays every tile out exactly once', () => {
    const def = toDefinition(
      draft({
        tiles: [
          {
            id: 'a',
            title: 'A',
            chartType: 'kpi',
            metrics: ['orders.count@orderdate'],
            dimensions: [],
          },
          {
            id: 'b',
            title: 'B',
            chartType: 'kpi',
            metrics: ['revenue.net@orderdate'],
            dimensions: [],
          },
        ],
      })
    );
    const laidOut = def.layout.rows.flatMap((r) => r.tileIds);
    expect(laidOut.sort()).toEqual(['a', 'b']);
  });

  it('collects required metrics from all tiles', () => {
    const def = toDefinition(
      draft({
        tiles: [
          {
            id: 'a',
            title: 'A',
            chartType: 'kpi',
            metrics: ['orders.count@orderdate'],
            dimensions: [],
          },
          {
            id: 'b',
            title: 'B',
            chartType: 'breakdown',
            metrics: ['revenue.net@orderdate'],
            dimensions: ['store'],
          },
        ],
      })
    );
    expect(def.requiredCapabilities.metrics.sort()).toEqual([
      'orders.count@orderdate',
      'revenue.net@orderdate',
    ]);
  });

  it('builds a funnel encoding from the step metrics', () => {
    const def = toDefinition(
      draft({
        tiles: [
          {
            id: 'f',
            title: 'Funnel',
            chartType: 'funnel',
            metrics: [
              'sessions.count',
              'addtocart.count',
              'orders.count@orderdate',
            ],
            dimensions: [],
          },
        ],
      })
    );
    expect(def.tiles[0].chart.encoding.steps).toEqual([
      'sessions.count',
      'addtocart.count',
      'orders.count@orderdate',
    ]);
  });

  it('gives a KPI a small span and a table a full span', () => {
    const def = toDefinition(
      draft({
        tiles: [
          {
            id: 'k',
            title: 'K',
            chartType: 'kpi',
            metrics: ['orders.count@orderdate'],
            dimensions: [],
          },
          {
            id: 't',
            title: 'T',
            chartType: 'table',
            metrics: ['revenue.net@orderdate'],
            dimensions: ['store'],
          },
        ],
      })
    );
    expect(def.tiles.find((t) => t.id === 'k')?.span).toBe(3);
    expect(def.tiles.find((t) => t.id === 't')?.span).toBe(12);
  });
});
