import type { CurrencyGrouping } from './region-config';

/**
 * Digit-string grouping — pure string/integer manipulation, no floating
 * point and no practical size limit (unlike `Number`, an 18-digit taka
 * amount round-trips exactly). `digits` must already be a plain non-negative
 * integer string (no sign, no separators, no decimal point) — callers strip
 * those first.
 */
export function groupDigits(digits: string, style: CurrencyGrouping): string {
  return style === 'lakh-crore' ? groupLakhCrore(digits) : groupThousand(digits);
}

/** ৳1,23,456 — the last three digits form one group, every group before
 * that is two digits (lakh, crore, ...). */
function groupLakhCrore(digits: string): string {
  if (digits.length <= 3) return digits;

  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);

  return [...groups, last3].join(',');
}

/** 1,234,567 — every group is three digits. */
function groupThousand(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
