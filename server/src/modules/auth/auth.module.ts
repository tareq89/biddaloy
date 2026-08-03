import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { ContextGuard, RolesGuard } from './guards/context.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserTenant } from './entities/user-tenant.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { LoginAttemptService } from './login-attempt.service';
import { RefreshTokenService, REFRESH_TOKEN_TTL_MS } from './refresh-token.service';
import { AccessTokenDenylistService, ACCESS_TOKEN_DENYLIST_REDIS } from './access-token-denylist.service';
import { RefreshTokenCleanupProcessor } from './refresh-token-cleanup.processor';
import { RefreshTokenCleanupScheduler } from './refresh-token-cleanup.scheduler';
import { REFRESH_TOKEN_CLEANUP_QUEUE } from './refresh-token-cleanup.constants';
import { ACCESS_TOKEN_TTL_MS } from './auth-tokens';

const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserTenant, AuditLog, RefreshToken]),
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
          signOptions: { expiresIn: Math.floor((ttlMs ? Number(ttlMs) : DEFAULT_ACCESS_TOKEN_TTL_MS) / 1000) },
        };
      },
    }),
    BullModule.registerQueue({
      name: REFRESH_TOKEN_CLEANUP_QUEUE,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ContextGuard,
    RolesGuard,
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
        const redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
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
      provide: ACCESS_TOKEN_DENYLIST_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        }),
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
    JwtStrategy,
    ACCESS_TOKEN_TTL_MS,
  ],
})
export class AuthModule {}