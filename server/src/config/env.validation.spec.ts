import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { validate } from './env.validation';

const validConfig = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/betonboi',
  JWT_SECRET: 'a'.repeat(32),
};

describe('env.validation', () => {
  it('accepts a config with all required fields present and valid', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it('rejects a missing JWT_SECRET', () => {
    const { JWT_SECRET: _omit, ...rest } = validConfig;
    expect(() => validate(rest)).toThrow();
  });

  it('rejects a JWT_SECRET shorter than 32 characters', () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: 'a'.repeat(31) })).toThrow();
  });

  it('accepts a JWT_SECRET exactly 32 characters', () => {
    expect(() => validate({ ...validConfig, JWT_SECRET: 'a'.repeat(32) })).not.toThrow();
  });

  it('accepts NODE_ENV=development', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'development' })).not.toThrow();
  });

  it('accepts NODE_ENV=test', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'test' })).not.toThrow();
  });

  it('accepts NODE_ENV=production', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'production' })).not.toThrow();
  });

  it('rejects an unrecognized NODE_ENV', () => {
    expect(() => validate({ ...validConfig, NODE_ENV: 'staging' })).toThrow();
  });

  it('accepts a missing NODE_ENV', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it('accepts a missing RATE_LIMIT_DEFAULT_LIMIT / RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate(validConfig)).not.toThrow();
  });

  it('accepts positive integer strings for RATE_LIMIT_DEFAULT_LIMIT and RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() =>
      validate({
        ...validConfig,
        RATE_LIMIT_DEFAULT_LIMIT: '250',
        RATE_LIMIT_DEFAULT_TTL_MS: '30000',
      }),
    ).not.toThrow();
  });

  // These reject malformed RATE_LIMIT_DEFAULT_LIMIT values at startup —
  // without them, a value like "abc" or "-1" would reach
  // resolveDefaultRateLimit()'s Number() conversion as NaN or a negative
  // limit instead of failing fast with a clear boot error.
  it('rejects a non-numeric RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: 'abc' })).toThrow();
  });

  it('rejects a RATE_LIMIT_DEFAULT_LIMIT with trailing non-digit characters', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '10px' })).toThrow();
  });

  it('rejects a negative RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '-1' })).toThrow();
  });

  it('rejects a zero RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '0' })).toThrow();
  });

  it('rejects a non-integer RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '1.5' })).toThrow();
  });

  it('rejects an empty-string RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: '' })).toThrow();
  });

  it('rejects a whitespace-only RATE_LIMIT_DEFAULT_LIMIT', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_LIMIT: ' ' })).toThrow();
  });

  // Same malformed-value coverage for RATE_LIMIT_DEFAULT_TTL_MS — it's
  // validated by an identical positive-integer pattern (see env.validation.ts).
  it('rejects a non-numeric RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: 'abc' })).toThrow();
  });

  it('rejects a RATE_LIMIT_DEFAULT_TTL_MS with trailing non-digit characters', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '10px' })).toThrow();
  });

  it('rejects a negative RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '-1' })).toThrow();
  });

  it('rejects a zero RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '0' })).toThrow();
  });

  it('rejects a non-integer RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '1.5' })).toThrow();
  });

  it('rejects an empty-string RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: '' })).toThrow();
  });

  it('rejects a whitespace-only RATE_LIMIT_DEFAULT_TTL_MS', () => {
    expect(() => validate({ ...validConfig, RATE_LIMIT_DEFAULT_TTL_MS: ' ' })).toThrow();
  });
});
