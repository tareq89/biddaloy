import { CouponDiscountKind } from '@biddaloy/shared';

/** The fields of a coupon that price an order. All money is whole paisa. */
export interface DiscountRule {
  kind: CouponDiscountKind;
  percent: number | null;
  fixedPaisa: number | null;
  maxMonths: number | null;
  maxDiscountPaisa: number | null;
  minOrderPaisa: number | null;
}

export interface DiscountOrder {
  seats: number;
  months: number;
  /** The LIST unit price per seat per month (D42). */
  unitPaisa: number;
}

export interface DiscountResult {
  discountPaisa: number;
  amountPaisa: number;
}

/**
 * D43: the one place a coupon is priced. Per month, base = seats x list unit price.
 * PERCENT takes `floor(base * percent / 100)` off each month; FIXED takes `min(fixed, base)`.
 * Only the first `min(maxMonths ?? months, months)` months are discounted. The total discount is
 * then capped by `maxDiscountPaisa` and never exceeds the list total.
 *
 * Returns `null` when the list total is below `minOrderPaisa` (the caller turns that into the one
 * generic refusal). BigInt inside so seats x months x price cannot lose precision.
 */
export function computeCouponDiscount(
  rule: DiscountRule,
  order: DiscountOrder,
): DiscountResult | null {
  const base = BigInt(order.seats) * BigInt(order.unitPaisa);
  const months = BigInt(order.months);
  const listTotal = base * months;
  if (rule.minOrderPaisa !== null && listTotal < BigInt(rule.minOrderPaisa)) return null;

  let perMonth =
    rule.kind === CouponDiscountKind.PERCENT
      ? (base * BigInt(rule.percent ?? 0)) / 100n
      : BigInt(rule.fixedPaisa ?? 0);
  if (perMonth > base) perMonth = base;

  const discounted =
    rule.maxMonths !== null && BigInt(rule.maxMonths) < months ? BigInt(rule.maxMonths) : months;
  let total = perMonth * discounted;
  if (rule.maxDiscountPaisa !== null && total > BigInt(rule.maxDiscountPaisa)) {
    total = BigInt(rule.maxDiscountPaisa);
  }
  if (total > listTotal) total = listTotal;

  return { discountPaisa: Number(total), amountPaisa: Number(listTotal - total) };
}
