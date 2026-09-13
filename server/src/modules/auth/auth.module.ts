import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { ContextGuard, RolesGuard } from './guards/context.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { ApprovalGuard, ApprovalService, APPROVAL_REDIS } from './guards/approval.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { StepUpController } from './step-up.controller';
import { StepUpService, STEP_UP_REDIS } from './step-up.service';
import { AccountAccessModule } from '../account-access/account-access.module';
import { SchoolsModule } from '../schools/schools.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserTenant } from './entities/user-tenant.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { LoginAttemptService } from './login-attempt.service';
import { RefreshTokenService, REFRESH_TOKEN_TTL_MS } from './refresh-token.service';
import {
  AccessTokenDenylistService,
  ACCESS_TOKEN_DENYLIST_REDIS,
} from './access-token-denylist.service';
import { RefreshTokenCleanupProcessor } from './refresh-token-cleanup.processor';
import { RefreshTokenCleanupScheduler } from './refresh-token-cleanup.scheduler';
import { REFRESH_TOKEN_CLEANUP_QUEUE } from './refresh-token-cleanup.constants';
import { ACCESS_TOKEN_TTL_MS } from './auth-tokens';

const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

/**
 * A Redis client tuned to fail fast rather than hang or queue commands
 * during an outage — shared by every "must not fail open" Redis-backed
 * check in this module (ACCESS_TOKEN_DENYLIST_REDIS, APPROVAL_REDIS).
 * `enableOfflineQueue: false`/`maxRetriesPerRequest: 1` cover a
 * *disconnected* client failing fast; `commandTimeout` additionally
 * covers a connection that accepted the TCP handshake but never replies,
 * which would otherwise hang the calling request indefinitely instead of
 * reaching the caller's own fail-open/fail-closed catch block.
 */
function createFailFastRedis(config: ConfigService, commandTimeout: number): Redis {
  return new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout,
  });
}

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserTenant, RefreshToken]),
    AuditModule,
    // `ContextGuard`'s `TenantStatusService` dependency comes from
    // `TenantStatusModule`'s `@Global()` export, not from an explicit
    // import here — see that module's file comment for why.
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const ttlMs = configService.get<string>('ACCESS_TOKEN_TTL_MS');
        return {
          secret: configService.get<string>('JWT_SECRET'),
          // jsonwebtoken accepts a plain number of seconds here — derived
          // from the same ms value AccessTokenDenylistService uses for its
          // TTL, so the two never drift apart.
          signOptions: {
            expiresIn: Math.floor((ttlMs ? Number(ttlMs) : DEFAULT_ACCESS_TOKEN_TTL_MS) / 1000),
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: REFRESH_TOKEN_CLEANUP_QUEUE,
    }),
    // 16.2.2's StepUpService reuses AccountAccessModule's OtpService (OTP
    // storage/verification) and SchoolsModule's getResolvedSettings
    // (approval_mode). Neither imports AuthModule back, so this is not a
    // cycle — both currently reach AuthModule's own exports (AuthService,
    // LoginAttemptService, etc.) only via @Global(), not an import of it.
    AccountAccessModule,
    SchoolsModule,
  ],
  controllers: [AuthController, StepUpController],
  providers: [
    AuthService,
    StepUpService,
    {
      provide: STEP_UP_REDIS,
      inject: [ConfigService],
      // Same fail-fast-friendly connection settings as
      // LoginAttemptService's/OtpService's clients — step-up's rate-limit
      // counters and single-use approval-token markers fail CLOSED on a
      // Redis error (see StepUpService), so this must fail fast rather
      // than hang.
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 1000,
        }),
    },
    JwtStrategy,
    ContextGuard,
    RolesGuard,
    PermissionsGuard,
    ApprovalGuard,
    ApprovalService,
    RefreshTokenService,
    AccessTokenDenylistService,
    RefreshTokenCleanupProcessor,
    RefreshTokenCleanupScheduler,
    {
      provide: LoginAttemptService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Distinct connection from BullMQ's/the throttler's: same
        // fail-open-friendly settings as the throttler's Redis client (see
        // rate-limit-tracker.ts's sibling ThrottlerModule wiring in
        // app.module.ts) — ioredis's default maxRetriesPerRequest queues
        // each command through several seconds of retries before rejecting,
        // which would turn "fail open" into "fail slow" during an outage.
        const redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        const threshold = config.get<string>('LOGIN_LOCKOUT_THRESHOLD');
        const windowMs = config.get<string>('LOGIN_LOCKOUT_WINDOW_MS');
        return new LoginAttemptService(
          redis,
          threshold ? Number(threshold) : 5,
          windowMs ? Number(windowMs) : 15 * 60_000,
        );
      },
    },
    {
      // isRevoked() runs on every authenticated request, inside
      // JwtStrategy.validate() — see createFailFastRedis's doc comment for
      // why this needs a commandTimeout, not just the offline-queue opts.
      provide: ACCESS_TOKEN_DENYLIST_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createFailFastRedis(config, 1000),
    },
    {
      // ApprovalService.consume() must not fail open on an outage — a hung
      // GETDEL would leak an approval-gated request through exactly the
      // guard meant to stop it.
      provide: APPROVAL_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createFailFastRedis(config, 1000),
    },
    {
      provide: ACCESS_TOKEN_TTL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttlMs = config.get<string>('ACCESS_TOKEN_TTL_MS');
        return ttlMs ? Number(ttlMs) : DEFAULT_ACCESS_TOKEN_TTL_MS;
      },
    },
    {
      provide: REFRESH_TOKEN_TTL_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttlMs = config.get<string>('REFRESH_TOKEN_TTL_MS');
        return ttlMs ? Number(ttlMs) : DEFAULT_REFRESH_TOKEN_TTL_MS;
      },
    },
  ],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    ContextGuard,
    RolesGuard,
    PermissionsGuard,
    ApprovalGuard,
    ApprovalService,
    JwtStrategy,
    ACCESS_TOKEN_TTL_MS,
    RefreshTokenService,
    AccessTokenDenylistService,
    // 12.5's OtpLoginService (account-access module) needs this to reset a
    // successful OTP sign-in's lockout state, same as AuthService.login does
    // for password sign-in.
    LoginAttemptService,
  ],
})
export class AuthModule {}
