import { describe, it, expect } from 'vitest';
import { redactSensitiveFields } from './redact.util';

describe('redactSensitiveFields', () => {
  it('redacts a known sensitive key at the top level', () => {
    expect(redactSensitiveFields({ password_hash: '$2b$10$abc', email: 'a@b.com' })).toEqual({
      password_hash: '[REDACTED]',
      email: 'a@b.com',
    });
  });

  it('matches sensitive keys case-insensitively', () => {
    expect(redactSensitiveFields({ Password_Hash: 'x', API_KEY: 'y' })).toEqual({
      Password_Hash: '[REDACTED]',
      API_KEY: '[REDACTED]',
    });
  });

  it('redacts sensitive keys nested inside an object', () => {
    expect(
      redactSensitiveFields({
        user: { id: 'u-1', password_hash: 'secret' },
        metadata: { token: 'abc123' },
      }),
    ).toEqual({
      user: { id: 'u-1', password_hash: '[REDACTED]' },
      metadata: { token: '[REDACTED]' },
    });
  });

  it('redacts sensitive keys inside array elements', () => {
    expect(redactSensitiveFields({ users: [{ id: 'u-1', secret: 'x' }, { id: 'u-2', secret: 'y' }] })).toEqual({
      users: [
        { id: 'u-1', secret: '[REDACTED]' },
        { id: 'u-2', secret: '[REDACTED]' },
      ],
    });
  });

  it('leaves non-sensitive values, including null and primitives, untouched', () => {
    expect(redactSensitiveFields({ count: 3, note: null, active: true })).toEqual({
      count: 3,
      note: null,
      active: true,
    });
  });
});
