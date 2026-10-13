/** Largest value a `decimal(10,2)` money column holds (every fees/fines/payments
 * amount column). DTOs cap at this so an oversized amount is a 400, not a
 * Postgres "numeric field overflow" 500. Change it together with the columns. */
export const MONEY_MAX = 99_999_999.99;
