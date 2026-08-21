import { BetaAnalyticsDataClient } from '@google-analytics/data';

/** One-off: prove the key authenticates AND has read access to the property. */
const main = async (): Promise<void> => {
  const creds = JSON.parse(process.env.GA4_SERVICE_ACCOUNT_JSON as string) as {
    client_email: string;
    private_key: string;
  };
  const property = process.env.GA4_PROPERTY_ID as string;
  const client = new BetaAnalyticsDataClient({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
  });
  const [report] = await client.runReport({
    property: `properties/${property}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
    limit: 10,
  });
  const rows = report.rows ?? [];
  process.stdout.write(
    JSON.stringify({
      ok: true,
      property,
      rowCount: rows.length,
      sample: rows.slice(0, 5).map((r) => ({
        date: r.dimensionValues?.[0]?.value,
        sessions: r.metricValues?.[0]?.value,
        users: r.metricValues?.[1]?.value,
      })),
    }) + '\n'
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(1);
});
