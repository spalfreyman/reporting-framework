import { useCallback } from 'react';
import {
  useMcMutation,
  useMcQuery,
} from '@commercetools-frontend/application-shell';
import { GRAPHQL_TARGETS } from '@commercetools-frontend/constants';
import type { ApolloError } from '@apollo/client';
import FetchCustomReports from './fetch-custom-reports.ctp.graphql';
import UpsertCustomReport from './upsert-custom-report.ctp.graphql';
import DeleteCustomReport from './delete-custom-report.ctp.graphql';
import {
  reportDefinitionSchema,
  type ReportDefinition,
} from '../../shared/schema/report-definition';

/**
 * Reads and writes user-created report definitions as Custom Objects.
 *
 * Deliberately goes through the Merchant Center platform GraphQL, using the operator's own
 * `manage_key_value_documents` scope, rather than through the gateway: the gateway is a
 * read-only query plane, and a save should be gated by the operator's session permissions,
 * not a service secret. The gateway then resolves built-in ∪ stored reports on the next read,
 * so a saved report simply appears in the catalogue.
 */

const CONTAINER = 'reporting.reports';

type CustomObjectResult = {
  id: string;
  version: number;
  key: string;
  value: unknown;
};
type FetchResult = { customObjects: { results: CustomObjectResult[] } };

export interface StoredReport {
  key: string;
  version: number;
  definition: ReportDefinition;
}

export interface UseReportDefinitionsResult {
  reports: StoredReport[];
  /** Keys whose stored value failed schema validation, surfaced rather than hidden. */
  invalid: Array<{ key: string; problem: string }>;
  loading: boolean;
  error?: ApolloError;
  refetch: () => Promise<unknown>;
  save: (definition: ReportDefinition) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const useReportDefinitions = (): UseReportDefinitionsResult => {
  const { data, loading, error, refetch } = useMcQuery<FetchResult>(
    FetchCustomReports,
    {
      context: { target: GRAPHQL_TARGETS.COMMERCETOOLS_PLATFORM },
      fetchPolicy: 'cache-and-network',
    }
  );

  const [upsert] = useMcMutation(UpsertCustomReport);
  const [del] = useMcMutation(DeleteCustomReport);

  const reports: StoredReport[] = [];
  const invalid: Array<{ key: string; problem: string }> = [];
  for (const entry of data?.customObjects.results ?? []) {
    const parsed = reportDefinitionSchema.safeParse(entry.value);
    if (parsed.success) {
      reports.push({
        key: entry.key,
        version: entry.version,
        definition: parsed.data,
      });
    } else {
      invalid.push({
        key: entry.key,
        problem: parsed.error.issues[0]?.message ?? 'invalid',
      });
    }
  }

  const save = useCallback(
    async (definition: ReportDefinition) => {
      // Validate before persisting: a malformed definition must never reach the store, where
      // it would then be skipped on read and silently vanish from the catalogue.
      const parsed = reportDefinitionSchema.parse({
        ...definition,
        origin: 'custom',
      });
      await upsert({
        variables: { container: CONTAINER, key: parsed.id, value: parsed },
        context: { target: GRAPHQL_TARGETS.COMMERCETOOLS_PLATFORM },
      });
      await refetch();
    },
    [upsert, refetch]
  );

  const remove = useCallback(
    async (key: string) => {
      await del({
        variables: { container: CONTAINER, key },
        context: { target: GRAPHQL_TARGETS.COMMERCETOOLS_PLATFORM },
      });
      await refetch();
    },
    [del, refetch]
  );

  return {
    reports,
    invalid,
    loading,
    ...(error ? { error } : {}),
    refetch,
    save,
    remove,
  };
};
