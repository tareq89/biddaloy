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
  return mapBodyParserError(exception) ?? mapUniqueViolation(exception);
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
