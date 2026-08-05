/**
 * Money amounts sized to exercise BD lakh (10^6, 6 digits) and crore (10^8,
 * 8 digits) formatting boundaries — the two digit-grouping thresholds where
 * a naive `toLocaleString('en-US')` diverges from BD numbering.
 */
import { faker } from './faker';

export type MoneyDigits = 4 | 5 | 6 | 7 | 8;

export function moneyAmount(digits?: MoneyDigits): number {
  const d = digits ?? faker.helpers.arrayElement<MoneyDigits>([4, 5, 6, 7, 8]);
  const min = 10 ** (d - 1);
  const max = 10 ** d - 1;
  return faker.number.int({ min, max });
}
