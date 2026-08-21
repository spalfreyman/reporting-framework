/**
 * The M1 gate. Validates every built-in report against the schema AND against the semantic
 * registry, so a report referencing a metric nobody defines, or joining a non-conformed
 * dimension across domains, fails CI rather than rendering a broken tile in production.
 */
import { BUILTIN_REPORTS } from '../src/catalogue/index.js';
import { getDimension, isConformed } from '../src/semantic/dimensions.js';
import { getMetric } from '../src/semantic/metrics.js';
import { resolveMetrics } from '../src/semantic/resolve.js';
import { validateRegistry } from '../src/semantic/resolve.js';

const problems: string[] = [];

for (const problem of validateRegistry()) problems.push(`registry: ${problem}`);

const reports = Object.values(BUILTIN_REPORTS);

for (const report of reports) {
  const tileIds = new Set(report.tiles.map((t) => t.id));
  const laidOut = new Set(report.layout.rows.flatMap((r) => r.tileIds));

  for (const id of laidOut) {
    if (!tileIds.has(id)) problems.push(`${report.id}: layout references missing tile "${id}"`);
  }
  for (const id of tileIds) {
    if (!laidOut.has(id)) problems.push(`${report.id}: tile "${id}" is never laid out`);
  }

  for (const metric of [...report.requiredCapabilities.metrics, ...report.optionalMetrics]) {
    if (!getMetric(metric)) {
      problems.push(`${report.id}: unknown metric "${metric}" in requiredCapabilities`);
    }
  }

  for (const filter of report.allowedFilters) {
    if (!getDimension(filter.dimension)) {
      problems.push(`${report.id}: unknown filter dimension "${filter.dimension}"`);
    }
  }

  for (const tile of report.tiles) {
    for (const metric of tile.query.metrics) {
      if (!getMetric(metric)) problems.push(`${report.id}/${tile.id}: unknown metric "${metric}"`);
    }
    for (const dimension of tile.query.dimensions) {
      if (!getDimension(dimension)) {
        problems.push(`${report.id}/${tile.id}: unknown dimension "${dimension}"`);
      }
    }

    // A tile only forces a CROSS-SOURCE join when its metrics share NO common domain — i.e.
    // no single source could serve all of them. When they share a domain (e.g. shipments.*
    // are all commerce/oms, or several are all commerce), one source can serve the tile and a
    // breakdown by a non-conformed dimension is safe. Only when the shared set is empty must
    // every breakdown dimension be conformed, or the join across sources is unsafe.
    const { baseMetrics } = resolveMetrics(tile.query.metrics);
    const domainSets = baseMetrics.map((m) => new Set(getMetric(m)?.domains ?? []));
    const commonDomains =
      domainSets.length === 0
        ? new Set<string>()
        : domainSets.reduce((acc, set) => new Set([...acc].filter((d) => set.has(d))));
    if (baseMetrics.length > 1 && commonDomains.size === 0) {
      for (const dimension of tile.query.dimensions) {
        if (!isConformed(dimension)) {
          problems.push(
            `${report.id}/${tile.id}: mixes metrics from different sources and breaks them ` +
              `down by "${dimension}", which is not conformed - that join would be unsafe`
          );
        }
      }
    }

    // topN and orderBy must reference something the tile actually selects.
    const selectable = new Set([...tile.query.metrics, ...tile.query.dimensions, 'date']);
    if (tile.query.topN && !selectable.has(tile.query.topN.by)) {
      problems.push(`${report.id}/${tile.id}: topN.by "${tile.query.topN.by}" is not selected`);
    }
    for (const order of tile.query.orderBy) {
      if (!selectable.has(order.column)) {
        problems.push(`${report.id}/${tile.id}: orderBy "${order.column}" is not selected`);
      }
    }

    // Every field a chart encodes must be selected by its own query, or the tile renders
    // an empty series with no indication why.
    const encoded = [...JSON.stringify(tile.chart.encoding).matchAll(/"field":"([^"]+)"/g)];
    for (const [, field] of encoded) {
      if (!selectable.has(field)) {
        problems.push(`${report.id}/${tile.id}: chart encodes "${field}", which is not selected`);
      }
    }
  }
}

console.log(
  `  validated ${reports.length} built-in report(s): ${reports.map((r) => r.id).join(', ')}`
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  x ${problem}`);
  process.exit(1);
}
console.log('Report catalogue is valid.');
