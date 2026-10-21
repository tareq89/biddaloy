import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';
import { MAX_ORDER_SEATS, SEAT_UNIT_PRICE_PAISA } from '../orders.service';
import { MONEY_MAX } from '../../../common/constants/money';

const KEY = '3f2b8c1e-5d4a-4b6e-9c7d-1a2b3c4d5e6f';
const bad = (o: object) => validateSync(plainToInstance(CreateOrderDto, o)).length > 0;

describe('CreateOrderDto', () => {
  it('accepts the bounds', () => {
    expect(bad({ seats: 1, months: 1, idempotency_key: KEY })).toBe(false);
    expect(bad({ seats: 100000, months: 24, idempotency_key: KEY })).toBe(false);
  });
  it('rejects out-of-range, fractional and non-uuid input', () => {
    expect(bad({ seats: 0, months: 1, idempotency_key: KEY })).toBe(true);
    expect(bad({ seats: 100001, months: 1, idempotency_key: KEY })).toBe(true);
    expect(bad({ seats: 1, months: 25, idempotency_key: KEY })).toBe(true);
    expect(bad({ seats: 1.5, months: 1, idempotency_key: KEY })).toBe(true);
    expect(bad({ seats: 1, months: 1, idempotency_key: 'x' })).toBe(true);
  });
  it('the largest order stays under MONEY_MAX', () => {
    expect((MAX_ORDER_SEATS * 24 * SEAT_UNIT_PRICE_PAISA) / 100).toBeLessThanOrEqual(MONEY_MAX);
  });
});
