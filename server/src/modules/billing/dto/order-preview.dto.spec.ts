import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OrderPreviewDto } from './order-preview.dto';

const bad = (o: object) => validateSync(plainToInstance(OrderPreviewDto, o)).length > 0;

describe('OrderPreviewDto', () => {
  it('accepts the bounds, with or without a coupon', () => {
    expect(bad({ seats: 1, months: 1 })).toBe(false);
    expect(bad({ seats: 100000, months: 24, coupon_code: 'SAVE-10' })).toBe(false);
  });
  it('rejects out-of-range, fractional and oversized input', () => {
    expect(bad({ seats: 0, months: 1 })).toBe(true);
    expect(bad({ seats: 1, months: 25 })).toBe(true);
    expect(bad({ seats: 1.5, months: 1 })).toBe(true);
    expect(bad({ seats: 1, months: 1, coupon_code: 'x'.repeat(65) })).toBe(true);
    expect(bad({ seats: 1, months: 1, coupon_code: 12 })).toBe(true);
  });
});
