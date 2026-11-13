import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AuditModule } from '../audit/audit.module';
import { PlatformIdentityModule } from '../platform-identity/platform-identity.module';
import { CouponAttemptLimiter } from './coupon-attempt.limiter';
import { CouponRedemptionService } from './coupon-redemption.service';
import { CouponsService } from './coupons.service';
import { PlatformCouponsController } from './platform-coupons.controller';

/** [Epic 100 #3870] Coupons: platform CRUD plus the redemption engine the billing and bundle flows call. */
@Module({
  imports: [AuditModule, PlatformIdentityModule],
  controllers: [PlatformCouponsController],
  providers: [
    CouponsService,
    CouponRedemptionService,
    {
      provide: CouponAttemptLimiter,
      inject: [ConfigService],
      // Same client settings as LoginAttemptService (auth.module.ts): no offline queue, one retry,
      // so a Redis outage fails fast and the limiter fails closed.
      useFactory: (config: ConfigService) =>
        new CouponAttemptLimiter(
          new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
            enableOfflineQueue: false,
            maxRetriesPerRequest: 1,
          }),
        ),
    },
  ],
  exports: [CouponsService, CouponRedemptionService],
})
export class CouponsModule {}
