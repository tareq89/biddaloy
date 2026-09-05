/**
 * The server's single error-response shape, from
 * `server/src/common/filters/error-response.ts`. There is no machine-readable
 * error code field — callers distinguish cases by `message`, which the
 * server keeps stable for exactly this reason.
 *
 * `message` is `string | string[]` because the global `ValidationPipe`
 * (`server/src/validation-pipe.ts`) throws `BadRequestException(string[])`
 * on every 400 — one entry per failed field, each in class-validator's
 * default `"<property> <constraint>"` shape (see
 * `error-response.ts`'s own `resolveDetailMessage` comment).
 */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  timestamp: string;
  path: string;
  requestId: string;
  /** [9.6] The server's optional per-error extra payload
   * (`server/src/common/filters/error-response.ts`'s `ErrorResponseBody
   * .details`) — e.g. attendance's 409 register-conflict response carries
   * `{ code: 'ATTENDANCE_VERSION_CONFLICT', current_version, register }`
   * here. Typed `unknown` (not a specific shape) because this is a
   * generic envelope field shared by every endpoint that opts into it;
   * a caller narrows it for its own known shape, same as `ApiError
   * .messages` is generic until a caller interprets it. */
  details?: Record<string, unknown>;
}

/** Wraps a failed request in the server's own error shape, so callers get
 * typed access to `statusCode`/`message`/`requestId` instead of digging
 * through an Axios error's `response.data`.
 *
 * `.message` (from `Error`) stays a single display string — a validation
 * array is joined, so every existing plain-text consumer (`toast`,
 * `MutationErrorMessage`) keeps working unchanged. `.messages` is always
 * an array (a single-string body becomes a one-element array) and exists
 * for callers that need the per-field structure back, e.g.
 * `parseValidationFieldErrors` (`ui/src/utils/server-validation-errors.ts`)
 * mapping a form's server-side errors onto the right input.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly requestId: string;
  readonly path: string;
  readonly timestamp: string;
  readonly messages: string[];
  /** [9.6] See `ApiErrorBody.details`'s own comment. `undefined`, not an
   * empty object, when the server sent none — `exactOptionalPropertyTypes`
   * distinguishes "no details field" from "details: {}" and a caller
   * checking `error.details?.current_version` needs the former. */
  readonly details: Record<string, unknown> | undefined;

  constructor(body: ApiErrorBody) {
    super(Array.isArray(body.message) ? body.message.join(' ') : body.message);
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.requestId = body.requestId;
    this.path = body.path;
    this.timestamp = body.timestamp;
    this.messages = Array.isArray(body.message) ? body.message : [body.message];
    this.details = body.details;
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

/** A 429 from the stock `@nestjs/throttler` guard — distinct from `ApiError`
 * because the one thing worth showing (how long to wait) lives in the
 * response's `Retry-After` header, not in the JSON body `ApiError` wraps.
 * `retryAfterSeconds` is `null` when the header is missing or unparseable,
 * so a caller always has a fallback ("try again shortly") rather than a
 * throw of its own. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null) {
    super('Too many attempts — rate limited.');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Thrown by `ui/src/hooks/auth.ts`'s `login()` when a real login succeeded
 * (correct credentials, a token was issued) but `memberships` is empty — a
 * user removed from every school they used to belong to. Distinct from
 * `ApiError`/`RateLimitedError`: this never comes from the network, the
 * server call itself succeeded. */
export class NoMembershipsError extends Error {
  constructor() {
    super('This account has no active school membership.');
    this.name = 'NoMembershipsError';
  }
}
