import { describe, expect, it } from 'vitest';

import { formatName } from './name';

describe('formatName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(formatName('  Rahim Uddin  ')).toBe('Rahim Uddin');
  });

  it('collapses internal runs of whitespace', () => {
    expect(formatName('Rahim   Uddin')).toBe('Rahim Uddin');
  });

  it('leaves correctly-formatted names and casing alone', () => {
    expect(formatName('Md. Rahim Uddin')).toBe('Md. Rahim Uddin');
  });

  it('handles a name with tabs/newlines from a pasted spreadsheet cell', () => {
    expect(formatName('Rahim\tUddin\n')).toBe('Rahim Uddin');
  });
});
