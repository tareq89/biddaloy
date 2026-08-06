import { delay, http, HttpResponse, type HttpHandler, type HttpResponseResolver } from 'msw';

/**
 * Shared plumbing for every handler in `./handlers/*` — the group files
 * build response bodies (typed, factory-backed), this file builds the HTTP
 * envelope around them: pagination, the server's error shape, artificial
 * latency, and reading the tenant/role context off the request.
 */

export const TENANT_HEADER = 'X-Tenant-ID';
export const ROLE_HEADER = 'X-Role';

/** Matches `ApiErrorBody` (`ui/src/api/errors.ts`) exactly — `client.ts`'s
 * `toApiError` only wraps a rejection as a typed `ApiError` when the
 * response body has this exact shape; anything else falls through to a
 * generic `Error`, which would silently break any test asserting on
 * `error.statusCode`/`error.requestId`. */
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
}

export function apiErrorBody(statusCode: number, message: string, path: string): ApiErrorBody {
  return {
    statusCode,
    message,
    timestamp: new Date().toISOString(),
    path,
    requestId: crypto.randomUUID(),
  };
}

/** A standalone handler that always fails with the given status — the
 * generic building block for "error variant selectable per test":
 * `server.use(errorHandler('get', '/api/v1/students', 500, 'boom'))`. */
export function errorHandler(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  status: number,
  message = 'Something went wrong',
): HttpHandler {
  return http[method](path, ({ request }) =>
    HttpResponse.json(apiErrorBody(status, message, new URL(request.url).pathname), { status }),
  );
}

/** Wraps an existing resolver with artificial latency — the generic
 * building block for "slow variant selectable per test":
 * `server.use(slowHandler('get', '/api/v1/students', studentsHandlers.list, 2000))`.
 * Composing over hand-duplicating a `*Slow` handler per endpoint keeps the
 * handler count linear in endpoints rather than in endpoints × variants. */
export function slowHandler(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  resolver: HttpResponseResolver,
  ms = 1000,
): HttpHandler {
  return http[method](path, async (info) => {
    await delay(ms);
    return resolver(info);
  });
}

/** Reads pagination query params the same way every list endpoint in this
 * API does (`QueryStudentDto` and its siblings — `page` default 1, `limit`
 * default 10) and slices `items` to match, returning the
 * `{ data, total, page, limit, totalPages }` envelope every list endpoint
 * uses (typed explicitly, e.g. by `AuditLogListResponseDto` — most list
 * endpoints' 2xx bodies are `content?: never` in schema.d.ts because the
 * server never attached an `@ApiResponse` type, not because the runtime
 * shape differs). */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginate<T>(items: readonly T[], url: string): Paginated<T> {
  const params = new URL(url).searchParams;
  // `Number()` alone accepts 0, negatives, NaN, and Infinity — `?limit=0`
  // would divide-by-zero into an `Infinity` that serializes to `null` in
  // JSON, and `?page=0` would produce a negative slice offset. Falling
  // back to the same defaults as a missing param keeps this a mock of the
  // server's *validated* query params, not a new way to break pagination
  // that the real API would reject with a 400 before ever reaching here.
  const requestedPage = Number(params.get('page') ?? '1');
  const requestedLimit = Number(params.get('limit') ?? '10');
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 10;
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    total: items.length,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(items.length / limit)),
  };
}

/** Reads the two headers `client.ts` always attaches once a tenant is
 * active, for handlers that need to branch on them (or a test that wants
 * to assert what was actually sent — see `tenantEchoHandler`). */
export function requestContext(request: Request): { tenantId: string | null; role: string | null } {
  return {
    tenantId: request.headers.get(TENANT_HEADER),
    role: request.headers.get(ROLE_HEADER),
  };
}

/** A handler whose entire job is reporting what it received — lets a test
 * assert `X-Tenant-ID`/`X-Role` were actually sent, and with what value,
 * without hand-writing a one-off resolver:
 * `server.use(tenantEchoHandler('get', '/api/v1/students'))`, then assert
 * on the response body's `tenantId`/`role`. */
export function tenantEchoHandler(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
): HttpHandler {
  return http[method](path, ({ request }) => HttpResponse.json(requestContext(request)));
}
