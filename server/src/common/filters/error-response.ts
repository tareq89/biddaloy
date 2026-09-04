import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  timestamp: string;
  path: string;
  requestId: string;
  stack?: string;
  /**
   * Machine-readable payload for a 4xx a client needs to act on beyond the
   * message string — e.g. [9.3]'s `PUT .../register` 409, which must carry
   * the full current register so 8.12.5's conflict dialog has something to
   * render. Populated only when the thrown `HttpException`'s response body
   * (the object passed to its constructor) has a `details` key; a plain
   * string-message exception never has one, so every exception thrown
   * before this existed is unaffected. Never present on a 5xx — those are
   * suppressed in production regardless (see `buildErrorResponseBody`).
   */
  details?: Record<string, unknown>;
}

export function resolveStatus(exception: unknown): number {
  return exception instanceof HttpException
    ? exception.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * The exception's own message, regardless of environment or status — used
 * for server-side logging, which must never be suppressed, and as the
 * candidate client-facing message before the production 5xx cut below.
 *
 * Reads `getResponse().message` rather than `.message`: the global
 * `ValidationPipe` throws `BadRequestException(stringArray)`, and
 * `HttpException.message` collapses any array-shaped response down to a
 * class-name fallback ("Bad Request Exception") — losing every field-level
 * validation error. `getResponse()` still carries the real array.
 */
export function resolveDetailMessage(exception: unknown): string | string[] {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null && 'message' in response) {
      return (response as { message: string | string[] }).message;
    }
    return exception.message;
  }
  if (exception instanceof Error) return exception.message;
  return 'Internal server error';
}

/**
 * The exception response's `details` key, if it has one — see
 * `ErrorResponseBody.details`'s docstring for why this exists and when it's
 * populated. `undefined` for every exception that isn't an `HttpException`
 * thrown with an object body carrying that key, which is every exception in
 * this codebase written before [9.3].
 */
export function resolveDetails(exception: unknown): Record<string, unknown> | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null || !('details' in response)) {
    return undefined;
  }
  const details = (response as { details: unknown }).details;
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}

/**
 * 5xx detail is suppressed in production — the exception may be an
 * `InternalServerErrorException(err.message)` or a wrapped TypeORM error
 * carrying a query fragment, column name, or connection string. 4xx always
 * passes through: those are deliberate and user-facing (validation arrays,
 * "Invalid credentials", tenant-header errors), and suppressing them would
 * break the SPAs that act on them.
 */
export function buildErrorResponseBody(
  exception: unknown,
  opts: { path: string; requestId: string; nodeEnv: string | undefined },
): ErrorResponseBody {
  const status = resolveStatus(exception);
  const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
  const isProduction = opts.nodeEnv === 'production';
  const detailMessage = resolveDetailMessage(exception);

  const body: ErrorResponseBody = {
    statusCode: status,
    message: isServerError && isProduction ? 'Internal server error' : detailMessage,
    timestamp: new Date().toISOString(),
    path: opts.path,
    requestId: opts.requestId,
  };

  if (isServerError && !isProduction && exception instanceof Error) {
    body.stack = exception.stack;
  }

  // Suppressed on a 5xx for the same reason `message` is above — a 5xx's
  // `details` (if any) is server-internal, not a client-facing contract.
  if (!isServerError) {
    const details = resolveDetails(exception);
    if (details) {
      body.details = details;
    }
  }

  return body;
}
