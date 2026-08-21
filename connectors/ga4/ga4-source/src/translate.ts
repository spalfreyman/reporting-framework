/**
 * Translation between the framework's semantic ids and GA4's own names.
 *
 * A few mappings carry real subtlety and are the difference between a correct join and a
 * silently wrong one:
 *  - `country` → GA4 `countryId`, NOT `country`. `countryId` returns the ISO-3166-1 alpha-2
 *    code, which is our conformed canonical key; `country` returns a display name ("Germany")
 *    that would never join to a commercetools country.
 *  - `device` → `deviceCategory`, whose values (desktop/mobile/tablet) match our key.
 */

export const METRIC_TO_GA4: Record<string, string> = {
  'sessions.count': 'sessions',
  'users.active': 'activeUsers',
  'pageviews.count': 'screenPageViews',
  'productviews.count': 'itemsViewed',
  'addtocart.count': 'addToCarts',
  'checkoutstart.count': 'checkouts',
  // GA4 has no first-class "site search" metric; these are event-count approximations and
  // are why every GA4 metric is flagged `sampled`/estimated. Live mode is best-effort.
  'searches.count': 'eventCount',
  'searches.zeroResult': 'eventCount',
};

export const DIMENSION_TO_GA4: Record<string, string> = {
  date: 'date',
  country: 'countryId',
  device: 'deviceCategory',
  trafficChannel: 'sessionDefaultChannelGroup',
  sourceMedium: 'sessionSourceMedium',
  campaign: 'sessionCampaignName',
  landingPage: 'landingPage',
  searchTerm: 'searchTerm',
};

/** GA4 returns `date` as YYYYMMDD; the framework uses ISO YYYY-MM-DD everywhere. */
export const ga4DateToIso = (compact: string): string =>
  /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : compact;

export const isoDateToGa4 = (iso: string): string => iso.replace(/-/g, '');
