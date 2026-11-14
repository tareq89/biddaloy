/** Whole-paisa VAT math. Prices are VAT-inclusive; no floats touch money (Rule 26). */
export const BP = 10_000;

/** The VAT already inside a gross amount: `gross - floor(gross * 10000 / (10000 + rate_bp))`. */
export function vatIncluded(amountPaisa: number, rateBp: number): number {
  if (amountPaisa <= 0 || rateBp <= 0) return 0;
  // BigInt keeps gross * 10000 exact even for a MONEY_MAX amount.
  const net = (BigInt(amountPaisa) * BigInt(BP)) / BigInt(BP + rateBp);
  return amountPaisa - Number(net);
}
