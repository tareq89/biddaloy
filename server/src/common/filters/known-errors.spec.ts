import { describe, it, expect } from 'vitest';
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
