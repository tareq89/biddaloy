import { describe, it, expect } from 'vitest';
import { MulterError } from 'multer';
import { QueryFailedError } from 'typeorm';
import { mapKnownError } from './known-errors';

/** Builds what body-parser / http-errors throw: a plain Error with status + type. */
function httpError(message: string, status?: number, type?: string) {
  return Object.assign(new Error(message), { status, type });
}

describe('mapKnownError — body-parser errors', () => {
  it('maps entity.too.large to 413', () => {
    const mapped = mapKnownError(httpError('request entity too large', 413, 'entity.too.large'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('Request body too large');
  });

  it('maps charset.unsupported to 415 without echoing the charset', () => {
    const mapped = mapKnownError(
      httpError('unsupported charset "BOGUS"', 415, 'charset.unsupported'),
    );
    expect(mapped?.getStatus()).toBe(415);
    expect(mapped?.message).toBe('Unsupported content type or encoding');
    expect(mapped?.message).not.toMatch(/bogus/i);
  });

  it('maps encoding.unsupported to 415', () => {
    expect(
      mapKnownError(
        httpError('unsupported content encoding "x"', 415, 'encoding.unsupported'),
      )?.getStatus(),
    ).toBe(415);
  });

  it('maps a bad gzip error (status 400, no type) to 400', () => {
    const mapped = mapKnownError(httpError('incorrect header check', 400));
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Invalid request body');
  });

  it('maps malformed JSON (entity.parse.failed) to 400', () => {
    expect(
      mapKnownError(
        httpError('Unexpected end of JSON input', 400, 'entity.parse.failed'),
      )?.getStatus(),
    ).toBe(400);
  });

  it('returns null for a plain Error, a 5xx status and non-errors', () => {
    expect(mapKnownError(new Error('boom'))).toBeNull();
    expect(mapKnownError(httpError('x', 503))).toBeNull();
    expect(mapKnownError('string')).toBeNull();
  });
});

/** A QueryFailedError shaped like the one the pg driver produces. */
function pgError(code: string, table: string) {
  const driverError = Object.assign(new Error('duplicate key'), {
    code,
    table,
    detail: 'Key (name)=(Secret Name) already exists.',
  });
  return new QueryFailedError('INSERT ...', [], driverError);
}

describe('mapKnownError — unique violations', () => {
  it.each([
    ['classes', 'A class with this name already exists in this year'],
    ['class_sections', 'A section with this name already exists in this class'],
    ['academic_years', 'An academic year with this name already exists'],
    ['somewhere_else', 'A record with these details already exists'],
  ])('maps 23505 on %s to a fixed 409', (table, text) => {
    const mapped = mapKnownError(pgError('23505', table));
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).toBe(text);
    expect(mapped?.message).not.toContain('Secret Name');
  });

  it('leaves other Postgres error codes alone', () => {
    expect(mapKnownError(pgError('23503', 'classes'))).toBeNull();
  });
});

describe('mapKnownError — multer errors', () => {
  it('maps LIMIT_UNEXPECTED_FILE to 400 without echoing the field name', () => {
    const mapped = mapKnownError(new MulterError('LIMIT_UNEXPECTED_FILE', 'secretfield'));
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Unexpected upload field');
    expect(mapped?.message).not.toContain('secretfield');
  });

  it('keeps LIMIT_FILE_SIZE at 413 "File too large"', () => {
    const mapped = mapKnownError(new MulterError('LIMIT_FILE_SIZE', 'file'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('File too large');
  });

  it.each([
    'LIMIT_FILE_COUNT',
    'LIMIT_PART_COUNT',
    'LIMIT_FIELD_KEY',
    'LIMIT_FIELD_VALUE',
    'LIMIT_FIELD_COUNT',
  ] as const)('maps %s to 400', (code) => {
    expect(mapKnownError(new MulterError(code))?.getStatus()).toBe(400);
  });

  it('ignores an Error that is not a MulterError', () => {
    expect(
      mapKnownError(Object.assign(new Error('x'), { code: 'LIMIT_UNEXPECTED_FILE' })),
    ).toBeNull();
  });
});
