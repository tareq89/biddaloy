import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditModule } from '../audit/audit.module';
import { APPROVAL_REDIS } from '../auth/guards/approval.guard';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { CouponAttemptLimiter } from './coupon-attempt.limiter';
import { CouponRedemptionService } from './coupon-redemption.service';
import { CouponsService } from './coupons.service';
import { PlatformCouponsController } from './platform-coupons.controller';

/**
 * [Epic 100 #3870] Owner coupon routes plus the redeem engine. The limiter rides the fail-fast
 * approval Redis (global from AuthModule), so an outage answers 429 instead of hanging (D23).
 * `AuthModule` / `ApprovalGuard` and `DataSource` come from global modules.
 */
@Module({
  imports: [AuditModule, PlatformIdentityModule],
  controllers: [PlatformCouponsController],
  providers: [
    CouponsService,
    CouponRedemptionService,
    {
      provide: CouponAttemptLimiter,
      useFactory: (redis: Redis) => new CouponAttemptLimiter(redis),
      inject: [APPROVAL_REDIS],
    },
  ],
  exports: [CouponRedemptionService],
})
export class CouponsModule {}
