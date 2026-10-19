import { FeeStatus } from '@biddaloy/shared';

const AMOUNT_EPSILON = 0.01;

/** Bill columns the shared allocation primitive below reads. A subset of
 * `StudentFee`, so a caller that only has those columns (not a full
 * hydrated entity) can still use it. */
export interface BillAllocationInput {
  total_amount: number;
  paid_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
}

export interface BillAllocationUpdate {
  paid_amount: number;
  one_off_discount_amount: number;
  discount_amount: number;
  status: FeeStatus;
}

/**
 * The shared "apply one allocation to a bill" primitive — [16.4.2]'s
 * checkout endpoint and the reversal flow ([16.6.1], not yet built) both
 * need to turn "this much money, plus this much one-off discount, is going
 * against this bill" into the bill's next `paid_amount`/
 * `one_off_discount_amount`/`discount_amount`/`status`, without
 * duplicating that arithmetic (and its PAID-threshold rule) at each call
 * site. Pure and side-effect free: the caller locks the row, persists the
 * result, and writes the corresponding `PaymentAllocation`.
 */
export function applyAllocationToBill(
  bill: BillAllocationInput,
  amount: number,
  oneOffDiscount = 0,
): BillAllocationUpdate {
  const newPaid = round2(Number(bill.paid_amount) + amount);
  const newOneOffDiscount = round2(Number(bill.one_off_discount_amount) + oneOffDiscount);
  const newDiscount = round2(Number(bill.standing_discount_amount) + newOneOffDiscount);
  const newStatus =
    newPaid + newDiscount >= Number(bill.total_amount) - AMOUNT_EPSILON
      ? FeeStatus.PAID
      : FeeStatus.PARTIALLY_PAID;
  return {
    paid_amount: newPaid,
    one_off_discount_amount: newOneOffDiscount,
    discount_amount: newDiscount,
    status: newStatus,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
