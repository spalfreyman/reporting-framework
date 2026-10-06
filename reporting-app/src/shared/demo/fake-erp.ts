import { DEMO_SKUS, seasonality } from './generator';
import { eachDay } from '../util/date-range';

/**
 * A deterministic fake ERP.
 *
 * Stands in for a real ERP/OMS so the operations and inventory reports render with no ERP
 * credentials. Keyed to the SAME SKUs and stores as the rest of the demo data (shared
 * generator), so stock, fulfilment and returns line up with sales rather than contradicting
 * them. Every figure is a pure function of its keys — no clock, no randomness.
 */

const hash = (input: string): number => {
  let h = 2166136261 >>> 0;
  for (const ch of input) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
};

export interface ErpInventoryRow {
  date: string;
  sku: string;
  warehouse: string;
  onHand: number;
  weeksCover: number;
}

export interface ErpFulfilmentRow {
  date: string;
  warehouse: string;
  carrier: string;
  shipments: number;
  onTime: number;
  pickToShipSeconds: number;
}

export interface ErpReturnsRow {
  date: string;
  reason: string;
  units: number;
}

const WAREHOUSES = ['wh-eu-central', 'wh-uk-south'];
const CARRIERS = ['DHL', 'Royal Mail', 'UPS'];
const RETURN_REASONS = ['too small', 'too large', 'not as described', 'faulty', 'changed mind'];

export const fakeInventory = (from: string, to: string): ErpInventoryRow[] => {
  const out: ErpInventoryRow[] = [];
  for (const date of eachDay({ from, to })) {
    for (const warehouse of WAREHOUSES) {
      // Sample a bounded slice of SKUs per warehouse per day — realistic and bounded.
      for (const sku of DEMO_SKUS.slice(0, 40)) {
        const h = hash(`${date}|${warehouse}|${sku}`);
        const onHand = 20 + (h % 480);
        const rateOfSale = 1 + (hash(sku) % 12);
        out.push({
          date,
          sku,
          warehouse,
          onHand,
          weeksCover: Math.round((onHand / rateOfSale) * 10) / 10,
        });
      }
    }
  }
  return out;
};

export const fakeFulfilment = (from: string, to: string): ErpFulfilmentRow[] => {
  const out: ErpFulfilmentRow[] = [];
  for (const date of eachDay({ from, to })) {
    const factor = seasonality(date);
    for (const warehouse of WAREHOUSES) {
      for (const carrier of CARRIERS) {
        const h = hash(`${date}|${warehouse}|${carrier}`);
        const shipments = Math.max(1, Math.round((40 + (h % 60)) * factor));
        // On-time rate dips on peak days when volume spikes — the interesting signal.
        const onTimeRate = factor > 1.5 ? 0.86 : 0.965 - (h % 5) / 100;
        out.push({
          date,
          warehouse,
          carrier,
          shipments,
          onTime: Math.round(shipments * onTimeRate),
          pickToShipSeconds: 3600 + (h % 7200) + (factor > 1.5 ? 5400 : 0),
        });
      }
    }
  }
  return out;
};

export const fakeReturns = (from: string, to: string): ErpReturnsRow[] => {
  const out: ErpReturnsRow[] = [];
  for (const date of eachDay({ from, to })) {
    for (const reason of RETURN_REASONS) {
      const h = hash(`${date}|${reason}`);
      out.push({ date, reason, units: h % 25 });
    }
  }
  return out;
};

