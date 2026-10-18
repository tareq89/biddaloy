import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';

/**
 * Maps errors that are not HttpExceptions but are the client's fault to a
 * proper 4xx. Every message is a fixed string: never copy the caught error's
 * message in (Rule 23 — e.g. the body-parser charset error echoes the value).
 * The filter still logs the ORIGINAL exception.
 */
export function mapKnownError(exception: unknown): HttpException | null {
  return mapBodyParserError(exception);
}

function mapBodyParserError(exception: unknown): HttpException | null {
  // HttpException also carries a numeric `status`; it already has its own body.
  if (!(exception instanceof Error) || exception instanceof HttpException) return null;
  const { status, type } = exception as Error & { status?: unknown; type?: unknown };
  if (typeof status !== 'number' || status < 400 || status > 499) return null;
  if (type === 'entity.too.large') return new PayloadTooLargeException('Request body too large');
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new HttpException('Unsupported content type or encoding', 415);
  }
  return new BadRequestException('Invalid request body');
}
