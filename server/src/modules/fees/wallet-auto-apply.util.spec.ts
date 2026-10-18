import { describe, it, expect } from 'vitest';
import { FeeStatus } from '@biddaloy/shared';
import { autoApply } from './wallet-auto-apply.util';

describe('autoApply (F-143)', () => {
  const totals = [100.1, 1000.3, 4999.99, 0.3];
  const discounts = [0.1, 0.2, 0.3, 0.7];

  for (const total of totals) {
    for (const discount of discounts) {
      if (discount >= total) continue;
      const due = Math.round((total - discount) * 100) / 100;
      it(`total ${total} discount ${discount}: balance == due is PAID to the cent`, () => {
        expect(autoApply(due, total, discount)).toEqual({ toApply: due, status: FeeStatus.PAID });
      });
      it(`total ${total} discount ${discount}: balance below due is PARTIALLY_PAID`, () => {
        const r = autoApply(0.01, total, discount);
        expect(r.toApply).toBe(0.01);
        expect(r.status).toBe(due > 0.01 ? FeeStatus.PARTIALLY_PAID : FeeStatus.PAID);
      });
    }
  }
});
