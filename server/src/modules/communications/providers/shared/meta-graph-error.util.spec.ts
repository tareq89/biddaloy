import { describe, it, expect } from 'vitest';
import { mapMetaGraphError } from './meta-graph-error.util';

describe('mapMetaGraphError', () => {
  it('maps code 190 to an authentication-rejected message', () => {
    expect(
      mapMetaGraphError({ error: { code: 190, message: 'Invalid OAuth token: abc123' } }),
    ).toBe('Authentication rejected — check the access token.');
  });

  it('maps code 100 to a not-found message', () => {
    expect(mapMetaGraphError({ error: { code: 100, message: 'Unsupported get request' } })).toBe(
      'Not found — check the ID and that the token has access to it.',
    );
  });

  it('falls back to a generic message for any other code', () => {
    expect(
      mapMetaGraphError({ error: { code: 4, message: 'Application request limit reached' } }),
    ).toBe('Connection test failed — could not verify the credentials.');
  });

  it('falls back to the generic message for a malformed or empty payload', () => {
    expect(mapMetaGraphError(null)).toBe(
      'Connection test failed — could not verify the credentials.',
    );
    expect(mapMetaGraphError({})).toBe(
      'Connection test failed — could not verify the credentials.',
    );
  });

  it('never echoes the raw error message back', () => {
    const secretLookingMessage = 'Invalid OAuth token: EAAG_super_secret_token_value';
    const result = mapMetaGraphError({ error: { code: 190, message: secretLookingMessage } });

    expect(result).not.toContain(secretLookingMessage);
    expect(result).not.toContain('EAAG_super_secret_token_value');
  });
});
