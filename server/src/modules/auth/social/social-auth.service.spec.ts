import { describe, it, expect } from 'vitest';
import { safeRedirect } from './social-auth.service';

const BASE = 'https://app.example.com';

describe('safeRedirect', () => {
  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '/\t/evil.com', '/\n/evil.com'])(
    'rejects %j',
    (value) => {
      expect(safeRedirect(value, BASE)).toBeUndefined();
    },
  );

  it('keeps a same-origin path with query and hash', () => {
    expect(safeRedirect('/dashboard?x=1#a', BASE)).toBe('/dashboard?x=1#a');
  });

  it('returns undefined for no value', () => {
    expect(safeRedirect(undefined, BASE)).toBeUndefined();
  });
});
