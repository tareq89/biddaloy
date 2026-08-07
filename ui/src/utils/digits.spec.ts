import { describe, expect, it } from 'vitest';

import { renderDigits, toLatinDigits } from './digits';

describe('renderDigits', () => {
  it('leaves digits alone for latin', () => {
    expect(renderDigits('1,23,456.00', 'latin')).toBe('1,23,456.00');
  });

  it('renders digits as Bengali numerals, leaving separators alone', () => {
    expect(renderDigits('1,23,456.00', 'bengali')).toBe('১,২৩,৪৫৬.০০');
  });

  it('renders every digit 0-9', () => {
    expect(renderDigits('0123456789', 'bengali')).toBe('০১২৩৪৫৬৭৮৯');
  });
});

describe('toLatinDigits', () => {
  it('converts Bengali digits to Latin', () => {
    expect(toLatinDigits('১,২৩,৪৫৬.০০')).toBe('1,23,456.00');
  });

  it('leaves Latin digits and separators alone', () => {
    expect(toLatinDigits('1,23,456.00')).toBe('1,23,456.00');
  });

  it('round-trips through renderDigits for every digit', () => {
    const latin = '0123456789';
    expect(toLatinDigits(renderDigits(latin, 'bengali'))).toBe(latin);
  });

  it('handles a mix of Bengali and Latin digits in the same string', () => {
    expect(toLatinDigits('১2৩4৫')).toBe('12345');
  });
});
