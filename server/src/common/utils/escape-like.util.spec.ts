import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './escape-like.util';

describe('escapeLikePattern', () => {
  it('leaves plain text unchanged', () => {
    expect(escapeLikePattern('Rahim Uddin')).toBe('Rahim Uddin');
  });

  it('escapes % so it matches a literal percent sign', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes _ so it does not match any single character', () => {
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslash itself', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
  });
});
