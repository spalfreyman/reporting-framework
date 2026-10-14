import type { ByProjectKeyRequestBuilder } from '@commercetools/platform-sdk';
import type { ColumnMeta, SourceQuery } from '../shared/schema/query.js';
import { DspFailure } from '../shared/dsp/server.js';

/**
 * Live promotion catalogue via the DiscountCode API — the active, code-driven promotions as they
 * are configured right now (NOT a rollup). Its whole purpose is to surface EVERY active promotion
 * keyed by `discountCode`, so when the gateway full-outer-joins this with `discount.redemptions`
 * (materialized), a promotion nobody has redeemed still shows up with 0 redemptions.
 *
 * Only code-driven promotions are listed: an automatic CartDiscount has no code, so it cannot key
 * on the discountCode dimension this report breaks down by.
 */

const NONE = '_none';

/** Dimensions this reader can key on. discountCode is the meaningful one; others collapse to NONE. */
const SUPPORTED_DIMENSIONS = new Set(['discountCode', 'store', 'currency']);

export interface LivePromotionsResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | number | null>>;
  partial: boolean;
  upstreamRequests: number;
}

interface DiscountCodeDoc {
  code: string;
  isActive?: boolean;
}

export const readLivePromotions = async (
  root: ByProjectKeyRequestBuilder,
  query: SourceQuery
): Promise<LivePromotionsResult> => {
  const breakdown = query.dimensions;
  for (const dim of query.dimensions) {
    if (!SUPPORTED_DIMENSIONS.has(dim)) {
      throw new DspFailure(
        'UNSUPPORTED_DIMENSION',
        `Live promotions cannot be broken down by "${dim}". Supported: ${[...SUPPORTED_DIMENSIONS].join(', ')}.`
      );
    }
  }

  // Fetch active discount codes, paginated.
  const codes: string[] = [];
  let upstreamRequests = 0;
  for (let offset = 0; ; offset += 500) {
    const res = await root
      .discountCodes()
      .get({ queryArgs: { where: 'isActive = true', limit: 500, offset } })
      .execute();
    upstreamRequests += 1;
    const body = res.body as { results: DiscountCodeDoc[]; count: number };
    for (const dc of body.results) if (dc.code) codes.push(dc.code);
    if (body.results.length < 500) break;
  }

  const wantsCode = query.dimensions.includes('discountCode');
  const columns: ColumnMeta[] = [
    ...breakdown.map((id) => ({
      id,
      role: 'dimension' as const,
      valueType: 'string' as const,
      exactness: 'exact' as const,
      nullMeaning: 'unknown' as const,
    })),
    {
      id: 'promotions.active',
      role: 'metric' as const,
      valueType: 'count' as const,
      exactness: 'exact' as const,
      nullMeaning: 'zero' as const,
    },
  ];

  // One row per active code when broken down by discountCode; otherwise a single total.
  const rows: Array<Array<string | number | null>> = wantsCode
    ? codes.map((code) => [
        ...breakdown.map((d) => (d === 'discountCode' ? code : NONE)),
        1,
      ])
    : [[...breakdown.map(() => NONE), codes.length]];

  return { columns, rows, partial: false, upstreamRequests: upstreamRequests || 1 };
};
