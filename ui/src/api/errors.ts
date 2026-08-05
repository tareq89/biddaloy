/**
 * The server's single error-response shape, from
 * `server/src/common/filters/error-response.ts`. There is no machine-readable
 * error code field — callers distinguish cases by `message`, which the
 * server keeps stable for exactly this reason.
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
}

/** Wraps a failed request in the server's own error shape, so callers get
 * typed access to `statusCode`/`message`/`requestId` instead of digging
 * through an Axios error's `response.data`. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly requestId: string;
  readonly path: string;
  readonly timestamp: string;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.requestId = body.requestId;
    this.path = body.path;
    this.timestamp = body.timestamp;
  }
}

/** Thrown synchronously, before a request is sent, when no tenant is active.
 * Distinct from ApiError: this never reaches the network, so it has no
 * server-shaped body to wrap. */
export class NoActiveTenantError extends Error {
  constructor() {
    super('No active tenant — cannot make an authenticated request without one.');
    this.name = 'NoActiveTenantError';
  }
}
