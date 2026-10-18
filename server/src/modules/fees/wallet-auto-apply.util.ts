import { FeeStatus } from '@biddaloy/shared';

const EPSILON = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Whole-paisa wallet auto-apply for a freshly generated bill [F-143]. */
export function autoApply(
  balance: number,
  total: number,
  discount: number,
): { toApply: number; status: FeeStatus } {
  const due = round2(total - discount);
  const toApply = round2(Math.min(balance, due));
  const status = toApply + EPSILON > due ? FeeStatus.PAID : FeeStatus.PARTIALLY_PAID;
  return { toApply, status };
}
