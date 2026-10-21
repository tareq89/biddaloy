import { describe, expect, it } from 'vitest';
import {
  FREE_UNTIL,
  PRICE_PER_SEAT_PAISA,
  SLAB_MONTHS,
  SLAB_STUDENTS,
  copy,
  formatBn,
  formatMoney,
  slabRows,
  total,
} from './pricing';

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

describe('pricing content', () => {
  it('totals in paisa', () => {
    expect(PRICE_PER_SEAT_PAISA).toBe(1000);
    expect(total(500, 6)).toBe(3_000_000);
    expect(formatMoney('bn', total(500, 6))).toBe('৳৩০,০০০');
  });

  it('free until matches the Epic 49 default', () => expect(FREE_UNTIL).toBe('2027-01-01'));
  it('copy years derive from FREE_UNTIL (D26)', () => {
    const y = +FREE_UNTIL.slice(0, 4);
    const bnYear = String(y).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[+d]);
    expect(copy.en.leadStrong).toContain(String(y - 1));
    expect(copy.en.leadPost).toContain(String(y));
    expect(copy.bn.leadPost).toContain(bnYear);
  });

  it('formats Bangla digits with en-IN grouping', () => {
    expect(formatBn('30000')).toBe('৩০,০০০');
    expect(formatBn(120000)).toBe('১,২০,০০০');
  });

  it('formats money per language', () => {
    expect(formatMoney('bn', 12_000_000)).toBe('৳১,২০,০০০');
    expect(formatMoney('en', 3_000_000)).toBe('৳30,000');
  });

  it('slab rows match the mockup table', () => {
    expect(SLAB_STUDENTS).toEqual([300, 500, 1000, 2000]);
    expect(SLAB_MONTHS).toEqual([1, 6, 12]);
    const bn = slabRows().map((r) => [formatBn(r.students), ...r.totals.map((t) => formatMoney('bn', t))]);
    expect(bn).toEqual([
      ['৩০০', '৳৩,০০০', '৳১৮,০০০', '৳৩৬,০০০'],
      ['৫০০', '৳৫,০০০', '৳৩০,০০০', '৳৬০,০০০'],
      ['১,০০০', '৳১০,০০০', '৳৬০,০০০', '৳১,২০,০০০'],
      ['২,০০০', '৳২০,০০০', '৳১,২০,০০০', '৳২,৪০,০০০'],
    ]);
  });

  it('copy names no payment provider or gateway (D11)', () => {
    const banned = /bkash|nagad|rocket|sslcommerz|stripe|paypal|gateway|card|বিকাশ|নগদ|কার্ড/i;
    for (const s of strings(copy)) expect(s).not.toMatch(banned);
  });

  it('both languages carry the same keys', () => expect(Object.keys(copy.en)).toEqual(Object.keys(copy.bn)));
});
