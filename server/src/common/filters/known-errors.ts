import {
  BadRequestException,
  ConflictException,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/**
 * Maps errors that are not HttpExceptions but are the client's fault to a
 * proper 4xx. Every message is a fixed string: never copy the caught error's
 * message in (Rule 23 — e.g. the body-parser charset error echoes the value).
 * The filter still logs the ORIGINAL exception.
 */
export function mapKnownError(exception: unknown): HttpException | null {
  return (
    mapBodyParserError(exception) ??
    mapUniqueViolation(exception) ??
    mapStudentFeeCheckViolation(exception) ??
    mapMulterError(exception)
  );
}

// Keyed on the table, never the index name (brittle) and never `detail`
// (it contains the submitted value — Rule 23).
const DUPLICATE_MESSAGE_BY_TABLE: Record<string, string> = {
  classes: 'A class with this name already exists in this year',
  class_sections: 'A section with this name already exists in this class',
  academic_years: 'An academic year with this name already exists',
};

function mapUniqueViolation(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, table } = exception.driverError as { code?: string; table?: string };
  if (code !== '23505') return null;
  return new ConflictException(
    DUPLICATE_MESSAGE_BY_TABLE[table ?? ''] ?? 'A record with these details already exists',
  );
}

// The money CHECKs on `student_fees` (migration 1791900000300). Services check the balance
// first; this is the backstop so a path that missed it is a 409, not a 500. Fixed text.
const STUDENT_FEE_MONEY_CHECKS = new Set(['CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled']);

function mapStudentFeeCheckViolation(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, constraint } = exception.driverError as { code?: string; constraint?: string };
  if (code !== '23514' || !STUDENT_FEE_MONEY_CHECKS.has(constraint ?? '')) return null;
  return new ConflictException({
    message: 'This would take more than the fee total',
    details: { code: 'STUDENT_FEE_OVER_TOTAL' },
  });
}

// The `type` values body-parser / raw-body set. Any other Error carrying a 4xx
// `status` (an SDK, other middleware) is not a request-body problem and stays a 500.
const BODY_PARSER_TYPES = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'request.aborted',
  'request.size.invalid',
  'charset.unsupported',
  'encoding.unsupported',
]);

function mapBodyParserError(exception: unknown): HttpException | null {
  // HttpException also carries a numeric `status`; it already has its own body.
  if (!(exception instanceof Error) || exception instanceof HttpException) return null;
  const { status, type, code } = exception as Error & {
    status?: unknown;
    type?: unknown;
    code?: unknown;
  };
  if (typeof status !== 'number' || status < 400 || status > 499) return null;
  // A bad gzip/deflate body: body-parser rethrows the zlib error (code Z_*) with no `type`.
  const isZlib = typeof code === 'string' && code.startsWith('Z_');
  if (!isZlib && !(typeof type === 'string' && BODY_PARSER_TYPES.has(type))) return null;
  if (type === 'entity.too.large') return new PayloadTooLargeException('Request body too large');
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new HttpException('Unsupported content type or encoding', 415);
  }
  return new BadRequestException('Invalid request body');
}

// Decided by `code`, never by message: multer 2.4 reworded "Unexpected field",
// which silently broke Nest's own message-based mapping. The message is fixed
// so the client's field name is not echoed (Rule 23).
function mapMulterError(exception: unknown): HttpException | null {
  if (!(exception instanceof Error) || exception.name !== 'MulterError') return null;
  return (exception as Error & { code?: string }).code === 'LIMIT_FILE_SIZE'
    ? new PayloadTooLargeException('File too large')
    : new BadRequestException('Unexpected upload field');
}
