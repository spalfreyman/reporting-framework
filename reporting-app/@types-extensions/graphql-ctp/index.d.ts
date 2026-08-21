/**
 * Declaration for GraphQL documents imported as modules.
 *
 * The template ships a generated file listing every `.ctp.graphql` individually. A single
 * wildcard covers all of them, current and future, so adding a query does not require
 * regenerating this file — and cannot silently fail to typecheck because someone forgot.
 */
declare module '*.ctp.graphql' {
  import type { DocumentNode } from 'graphql';
  const defaultDocument: DocumentNode;
  export default defaultDocument;
}

declare module '*.graphql' {
  import type { DocumentNode } from 'graphql';
  const defaultDocument: DocumentNode;
  export default defaultDocument;
}
