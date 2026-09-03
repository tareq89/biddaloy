import { describe, expect, it } from 'vitest';
import { normalizeSearchTerm } from './normalize-search-term.util';

describe('normalizeSearchTerm', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeSearchTerm('  Rahim  ')).toBe('Rahim');
  });

  it('converts Bengali digits to Latin so roll-number search matches', () => {
    expect(normalizeSearchTerm('১০৩')).toBe('103');
  });

  it('escapes LIKE metacharacters so they cannot act as wildcards', () => {
    expect(normalizeSearchTerm('100%')).toBe('100\\%');
    expect(normalizeSearchTerm('a_b')).toBe('a\\_b');
  });

  it('returns null for undefined input', () => {
    expect(normalizeSearchTerm(undefined)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeSearchTerm(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizeSearchTerm('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(normalizeSearchTerm('   ')).toBeNull();
  });
});
