import type {
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Build the OpenAPI schema for this codebase's standard paginated envelope.
 *
 * Every paginated service method returns the same shape:
 *
 * ```json
 * { "data": [ ... ], "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
 * ```
 *
 * Nest's swagger plugin infers response schemas from a controller method's
 * *return type*. On a route whose return type is a role-dependent union
 * (staff rows vs. an allow-listed family DTO) that inference fails and the
 * envelope is published as an untyped object — which reaches the client as
 * `Record<string, never>` in `ui/src/api/schema.d.ts`. Those routes declare
 * the contract explicitly instead, and this helper keeps the envelope part
 * identical across them.
 *
 * @param itemSchemas one schema per variant a `data[]` row can take, usually
 *   `getSchemaPath(X)` refs. A single entry is emitted as a plain `$ref`; two
 *   or more become a `oneOf`.
 */
export function paginatedSchema(itemSchemas: (SchemaObject | ReferenceObject)[]): SchemaObject {
  const items = itemSchemas.length === 1 ? itemSchemas[0] : { oneOf: itemSchemas };
  return {
    type: 'object',
    required: ['data', 'total', 'page', 'limit', 'totalPages'],
    properties: {
      data: { type: 'array', items },
      total: { type: 'integer', description: 'Total rows matching the query, across all pages.' },
      page: { type: 'integer', description: '1-based index of the page returned.' },
      limit: { type: 'integer', description: 'Maximum rows per page.' },
      totalPages: { type: 'integer', description: 'Number of pages at this `limit`.' },
    },
  };
}
