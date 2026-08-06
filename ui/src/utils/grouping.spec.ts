import { describe, expect, it } from 'vitest';

import { groupDigits } from './grouping';

describe('groupDigits — lakh-crore', () => {
  it.each([
    ['1', '1'],
    ['12', '12'],
    ['123', '123'],
    ['1234', '1,234'],
    ['12345', '12,345'],
    ['123456', '1,23,456'],
    ['1234567', '12,34,567'],
    ['12345678', '1,23,45,678'],
    ['123456789', '12,34,56,789'],
  ])('groups %s digits as %s across the 4-8 digit boundaries', (digits, expected) => {
    expect(groupDigits(digits, 'lakh-crore')).toBe(expected);
  });
});

describe('groupDigits — thousand', () => {
  it.each([
    ['1', '1'],
    ['123', '123'],
    ['1234', '1,234'],
    ['1234567', '1,234,567'],
  ])('groups %s digits as %s', (digits, expected) => {
    expect(groupDigits(digits, 'thousand')).toBe(expected);
  });
});
