/** Largest value a `decimal(10,2)` money column holds: fee structures, student
 * fees, payment allocations, payment totals and fine rules. The wallet and
 * tendered/change columns are `decimal(12,2)`, so this cap is the tighter one
 * for them too. DTOs cap each field at this so an oversized amount is a 400,
 * not a Postgres "numeric field overflow" 500. It bounds each field, not a sum:
 * `payments.total_amount` holds the sum of the checkout lines (#2484).
 * Change it together with the columns. */
export const MONEY_MAX = 99_999_999.99;

/** A money value in whole paisa. Money compares in paisa, never with a tolerance (#2636). */
export const toPaisa = (n: number | string): number => Math.round(Number(n) * 100);
