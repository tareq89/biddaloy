import { vi } from 'vitest';
import { CouponAttemptLimiter } from '../coupons/coupon-attempt.limiter';
import { CouponRedemptionService } from '../coupons/coupon-redemption.service';
import { PlansService } from '../plans/plans.service';
import { MoneyNoticesService } from './money-notices.service';
import { VatService } from './vat.service';

/**
 * Providers OrdersService needs in a test module (needs AuditService from the caller). Listed
 * explicitly because the leaf module that wires them for the app lands with #3875.
 */
export const ordersTestDeps = (extra: { moneyNotices?: unknown; vat?: unknown } = {}) => [
  PlansService,
  CouponRedemptionService,
  {
    provide: CouponAttemptLimiter,
    useValue: { assertAllowed: async () => undefined, recordFailure: async () => undefined },
  },
  {
    provide: VatService,
    useValue: extra.vat ?? {
      get: async () => ({ rate_bp: null, label: 'VAT', registration: null }),
    },
  },
  {
    provide: MoneyNoticesService,
    useValue: extra.moneyNotices ?? { couponApplied: vi.fn().mockResolvedValue(undefined) },
  },
];
