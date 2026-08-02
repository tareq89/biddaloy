import { HttpException, HttpStatus } from "@nestjs/common";

export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  timestamp: string;
  path: string;
  requestId: string;
  stack?: string;
}

export function resolveStatus(exception: unknown): number {
  return exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
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
    if (typeof response === "object" && response !== null && "message" in response) {
      return (response as { message: string | string[] }).message;
    }
    return exception.message;
  }
  if (exception instanceof Error) return exception.message;
  return "Internal server error";
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
  const isProduction = opts.nodeEnv === "production";
  const detailMessage = resolveDetailMessage(exception);

  const body: ErrorResponseBody = {
    statusCode: status,
    message: isServerError && isProduction ? "Internal server error" : detailMessage,
    timestamp: new Date().toISOString(),
    path: opts.path,
    requestId: opts.requestId,
  };

  if (isServerError && !isProduction && exception instanceof Error) {
    body.stack = exception.stack;
  }

  return body;
}
