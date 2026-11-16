import { describe, expect, it } from 'vitest';

// D42: the owner fills every [bracket] before the first paying school.
// Today this only WARNS (lists them). Flip to true at launch to make it fail.
const FAIL_ON_PLACEHOLDERS = false;

const files = import.meta.glob('./**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

function findPlaceholders(texts: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(texts)) {
    for (const m of text.matchAll(/\[[^\]\n]+\]/g)) found.push(`${path}: ${m[0]}`);
  }
  return found;
}

describe('legal placeholders (D42)', () => {
  it('finds a [bracket] placeholder', () => {
    expect(findPlaceholders({ 'a.md': 'Call [phone] now' })).toEqual(['a.md: [phone]']);
    expect(findPlaceholders({ 'a.md': 'no brackets' })).toEqual([]);
  });

  it('lists the placeholders still in the legal texts', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
    const found = findPlaceholders(files);
    if (found.length > 0) {
      console.warn(`WARNING: ${found.length} legal placeholder(s) left:\n${found.join('\n')}`);
    }
    if (FAIL_ON_PLACEHOLDERS) expect(found).toEqual([]);
  });
});
