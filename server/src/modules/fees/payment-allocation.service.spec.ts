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
