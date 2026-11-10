import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { PlatformAdminDevice } from '../../platform-identity/entities/platform-admin-device.entity';
import { AccountAccessModule } from '../../account-access/account-access.module';
import { PlatformIdentityModule } from '../../platform-identity/platform-identity.module';
import { AuditModule } from '../../audit/audit.module';
import { MfaModule } from '../mfa/mfa.module';
import { CockpitJwtStrategy } from '../strategies/cockpit-jwt.strategy';
import { CockpitAuthController } from './cockpit-auth.controller';
import { CockpitAuthService } from './cockpit-auth.service';
import { CockpitDeviceService } from './cockpit-device.service';
import { CockpitEnrolController } from './cockpit-enrol.controller';
import { CockpitEnrolService } from './cockpit-enrol.service';
import { CockpitPasswordController } from './cockpit-password.controller';
import { CockpitPasswordService } from './cockpit-password.service';
import { CockpitSessionController } from './cockpit-session.controller';
import { COCKPIT_REDIS, CockpitSessionService } from './cockpit-session.service';
import { CockpitStepTokens } from './cockpit-step-token';

/**
 * [Epic 98] Cockpit sign-in: password, device OTP, authenticator, enrolment, reset, session.
 * `AuthModule` is `@Global()` and exports JwtModule, LoginAttemptService, RefreshTokenService,
 * SessionCutoffService and AccessTokenDenylistService, so they are not imported again here.
 * COCKPIT_SESSION_LIMITS is optional (30 min idle, 8 h absolute by default), so it is not provided.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, PlatformAdmin, PlatformAdminDevice]),
    AccountAccessModule,
    MfaModule,
    AuditModule,
    PlatformIdentityModule, // PlatformAdminGuard needs PlatformHomeService
  ],
  controllers: [
    CockpitSessionController,
    CockpitAuthController,
    CockpitEnrolController,
    CockpitPasswordController,
  ],
  providers: [
    CockpitSessionService,
    CockpitAuthService,
    CockpitEnrolService,
    CockpitPasswordService,
    CockpitDeviceService,
    CockpitStepTokens,
    CockpitJwtStrategy,
    {
      // Session idle/absolute markers decide "is this session alive": a hung Redis must fail
      // fast into the caller's refusal, not hang the request (same settings as AuthModule's).
      provide: COCKPIT_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 1000,
        }),
    },
  ],
  exports: [CockpitSessionService, CockpitAuthService],
})
export class CockpitAuthModule {}
