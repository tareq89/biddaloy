import { describe, expect, it } from 'vitest';

import { amountInWords } from './amount-in-words';

describe('amountInWords', () => {
  const cases: Array<[number, string, string]> = [
    [2500, 'Taka Two Thousand Five Hundred only', 'দুই হাজার পাঁচশত টাকা মাত্র'],
    [125000, 'Taka One Lakh Twenty-Five Thousand only', 'এক লক্ষ পঁচিশ হাজার টাকা মাত্র'],
    [10000000, 'Taka One Crore only', 'এক কোটি টাকা মাত্র'],
    [1500000000, 'Taka One Hundred Fifty Crore only', 'একশত পঞ্চাশ কোটি টাকা মাত্র'],
    [50.25, 'Taka Fifty and Twenty-Five Paisa only', 'পঞ্চাশ টাকা পঁচিশ পয়সা মাত্র'],
    [0, 'Taka Zero only', 'শূন্য টাকা মাত্র'],
  ];
  it.each(cases)('%s', (n, en, bn) => {
    expect(amountInWords(n, 'en')).toBe(en);
    expect(amountInWords(n, 'bn')).toBe(bn);
  });

  it('treats negatives as their absolute value', () => {
    expect(amountInWords(-900, 'en')).toBe(amountInWords(900, 'en'));
    expect(amountInWords(-900, 'bn')).toBe(amountInWords(900, 'bn'));
  });

  it('has a distinct bn word for every 0-99', () => {
    const seen = new Set(Array.from({ length: 100 }, (_, i) => amountInWords(i, 'bn')));
    expect(seen.size).toBe(100);
  });
});
