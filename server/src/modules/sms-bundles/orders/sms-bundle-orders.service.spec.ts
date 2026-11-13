import { describe, it, expect } from 'vitest';
import { SmsBundleOrderStatus as S } from '@biddaloy/shared';
import { canMove } from './sms-bundle-orders.service';

describe('canMove', () => {
  // The only legal moves; every other pair must be refused.
  const legal: Array<[S, S]> = [
    [S.PENDING_PAYMENT, S.PAID],
    [S.PENDING_PAYMENT, S.CANCELLED],
    [S.PAID, S.ACTIVE],
    [S.ACTIVE, S.USED_UP],
    [S.ACTIVE, S.EXPIRED],
    [S.ACTIVE, S.REFUNDED],
  ];
  const all = Object.values(S);

  it('allows exactly the six legal moves', () => {
    for (const from of all)
      for (const to of all) {
        const want = legal.some(([f, t]) => f === from && t === to);
        expect(canMove(from, to), `${from} -> ${to}`).toBe(want);
      }
  });
  it('an unknown status moves nowhere', () => {
    expect(canMove('NOPE' as S, S.PAID)).toBe(false);
  });
});
