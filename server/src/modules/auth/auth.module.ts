import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { ContextGuard, RolesGuard } from './guards/context.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserTenant } from './entities/user-tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { LoginAttemptService } from './login-attempt.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserTenant, AuditLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ContextGuard,
    RolesGuard,
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
  ],
  exports: [AuthService, JwtModule, PassportModule, ContextGuard, RolesGuard, JwtStrategy],
})
export class AuthModule {}