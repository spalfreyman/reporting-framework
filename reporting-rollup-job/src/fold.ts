import type { CustomObjectPort } from './shared/ct/ports.js';
import type { OrderFact } from './shared/rollup/keying.js';
import {
  cubeContainer,
  dayPartitionKey,
  shardCells,
  topNWithResidual,
  type DayPartition,
  type FactCell,
} from './shared/rollup/keying.js';
import {
  NONE,
  foldOrderLinesDaily,
  foldOrdersDaily,
} from './shared/rollup/order-mapping.js';
import { orderFactContainerFor } from './shared/rollup/keying.js';
import { stableHash } from './shared/util/hash.js';
import type { Logger } from './logger.js';

/**
 * Rebuilds a day's partitions from that day's order-facts — a FULL rebuild, never a delta.
 * Rebuilding converges and is auditable; incrementing drifts and cannot be checked.
 *
 * Reading the facts for a day is a `where` scan over the month container, which is bounded
 * because order-facts are sharded by month.
 */

export interface FoldResult {
  cube: string;
  day: string;
  rows: number;
  shards: number;
  /** True when the rebuilt partition was byte-identical to what was already stored. */
  unchanged: boolean;
}

const readOrderFactsForDay = async (
  port: CustomObjectPort,
  day: string
): Promise<OrderFact[]> => {
  const container = orderFactContainerFor(day);
  const facts: OrderFact[] = [];
  let offset = 0;
  for (;;) {
    const page = await port.query<OrderFact>(container, {
      where: `value(businessDate = "${day}")`,
      limit: 100,
      offset,
    });
    facts.push(...page.results.map((entry) => entry.value));
    if (page.results.length < 100) break;
    offset += page.results.length;
  }
  return facts;
};

const writePartition = async (
  port: CustomObjectPort,
  cube: string,
  day: string,
  timezone: string,
  cells: FactCell[],
  sourceOrderCount: number,
  restatementEpoch: number,
  now: Date
): Promise<FoldResult> => {
  const shards = shardCells(cells);
  const contentHash = stableHash(cells);

  // Skip a rebuild that would change nothing: the content hash is stored on shard 0.
  const existingFirst = await port.get<DayPartition>(cubeContainer(cube), dayPartitionKey(day, 0));
  if (existingFirst && existingFirst.value.meta.contentHash === contentHash) {
    return { cube, day, rows: cells.length, shards: shards.length, unchanged: true };
  }

  for (let shard = 0; shard < shards.length; shard += 1) {
    const partition: DayPartition = {
      schemaVersion: 1,
      cube,
      grain: 'day',
      date: day,
      timezone,
      shard,
      shards: shards.length,
      meta: {
        builtAt: now.toISOString(),
        materializationId: `mat_${now.toISOString()}`,
        watermark: now.toISOString(),
        restatementEpoch,
        sourceOrderCount,
        rowCount: shards[shard].length,
        contentHash,
      },
      rows: shards[shard],
    };
    const key = dayPartitionKey(day, shard);
    const existing = await port.get<DayPartition>(cubeContainer(cube), key);
    await port.put(cubeContainer(cube), key, partition, existing?.version);
  }

  // Remove any now-surplus shards from a previous, larger rebuild.
  for (let shard = shards.length; ; shard += 1) {
    const key = dayPartitionKey(day, shard);
    const stale = await port.get<DayPartition>(cubeContainer(cube), key);
    if (!stale) break;
    await port.delete(cubeContainer(cube), key);
  }

  return { cube, day, rows: cells.length, shards: shards.length, unchanged: false };
};

export const foldDay = async (
  port: CustomObjectPort,
  day: string,
  options: { cubes: string[]; timezone: string; restatementEpoch: number; itemTopN: number; now: Date },
  log: Logger
): Promise<FoldResult[]> => {
  const facts = await readOrderFactsForDay(port, day);
  const results: FoldResult[] = [];

  for (const cube of options.cubes) {
    let cells: FactCell[];
    if (cube === 'orders-daily') {
      cells = foldOrdersDaily(facts);
    } else if (cube === 'order-lines-daily') {
      // Cap item grain at top-N per store, folding the tail into __other__ — this is what
      // keeps a large catalogue on the Custom Object tier.
      const byStore = new Map<string, FactCell[]>();
      for (const cell of foldOrderLinesDaily(facts)) {
        const store = cell.k.store ?? NONE;
        byStore.set(store, [...(byStore.get(store) ?? []), cell]);
      }
      cells = [...byStore.values()].flatMap((storeCells) =>
        topNWithResidual(storeCells, 'revenueNet', options.itemTopN, {
          currency: storeCells[0]?.k.currency ?? NONE,
          store: storeCells[0]?.k.store ?? NONE,
          product: '__other__',
        })
      );
    } else {
      continue;
    }

    const result = await writePartition(
      port,
      cube,
      day,
      options.timezone,
      cells,
      facts.length,
      options.restatementEpoch,
      options.now
    );
    results.push(result);
  }

  log.debug('folded day', {
    day,
    facts: facts.length,
    cubes: results.map((r) => `${r.cube}:${r.rows}${r.unchanged ? '(unchanged)' : ''}`),
  });
  return results;
};
