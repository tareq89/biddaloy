import { FeeStatus } from '@biddaloy/shared';
import { applyAllocationToBill } from './payment-allocation.service';

// #2685: money compares in whole paisa, no 0.01 tolerance.
const bill = (paid = 0) => ({
  total_amount: 500,
  paid_amount: paid,
  standing_discount_amount: 0,
  one_off_discount_amount: 0,
});

describe('applyAllocationToBill', () => {
  it('a bill 0.01 short stays PARTIALLY_PAID', () => {
    expect(applyAllocationToBill(bill(), 499.99).status).toBe(FeeStatus.PARTIALLY_PAID);
  });
  it('exact settle is PAID', () => {
    expect(applyAllocationToBill(bill(), 500).status).toBe(FeeStatus.PAID);
    expect(applyAllocationToBill(bill(250.1), 249.9).status).toBe(FeeStatus.PAID);
  });
  it('discount counts toward settle in paisa', () => {
    expect(applyAllocationToBill(bill(), 499.99, 0.01).status).toBe(FeeStatus.PAID);
    expect(applyAllocationToBill(bill(), 499.98, 0.01).status).toBe(FeeStatus.PARTIALLY_PAID);
  });
});

// Rule 26 table test: over many random whole-paisa amounts the bill is PAID exactly
// when paid + discount covers the total in paisa. No fast-check dependency, so a seeded LCG.
describe('applyAllocationToBill paisa table (Rule 26)', () => {
  it('PAID flips at exactly the covering paisa, for 5000 random amounts', () => {
    let seed = 2685;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      const totalP = 1 + rnd(9_999_999);
      const discP = rnd(totalP + 1);
      const owedP = totalP - discP;
      for (const delta of [-1, 0, 1]) {
        const p = Math.max(0, owedP + delta);
        const status = applyAllocationToBill(
          {
            total_amount: totalP / 100,
            paid_amount: 0,
            standing_discount_amount: discP / 100,
            one_off_discount_amount: 0,
          },
          p / 100,
        ).status;
        expect(status, `total=${totalP} disc=${discP} pay=${p}`).toBe(
          p >= owedP ? FeeStatus.PAID : FeeStatus.PARTIALLY_PAID,
        );
      }
    }
  });
});
