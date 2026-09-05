import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AuthToken } from './entities/auth-token.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { School } from '../schools/entities/school.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationsModule } from '../communications/communications.module';
import { SchoolsModule } from '../schools/schools.module';
import { AuditModule } from '../audit/audit.module';
import { AuthTokenService } from './auth-token.service';
import { OtpService, OTP_REDIS } from './otp.service';
import { AccountAccessDeliveryService } from './account-access-delivery.service';
import { InvitationService } from './invitation.service';
import { ActivationService } from './activation.service';
import { RecoveryService } from './recovery.service';
import { AccountAccessController } from './account-access.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthToken, User, UserTenant, School, CommunicationLog]),
    CommunicationsModule,
    SchoolsModule,
    AuditModule,
    ConfigModule,
  ],
  controllers: [AccountAccessController],
  providers: [
    AuthTokenService,
    AccountAccessDeliveryService,
    InvitationService,
    ActivationService,
    RecoveryService,
    {
      provide: OTP_REDIS,
      inject: [ConfigService],
      // Same fail-fast-friendly connection settings as
      // LoginAttemptService's client (auth.module.ts) plus a
      // commandTimeout — OtpService fails closed on a Redis outage, so an
      // established-but-unresponsive connection must not hang a request
      // indefinitely either.
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 1000,
        }),
    },
    OtpService,
  ],
  exports: [
    AuthTokenService,
    OtpService,
    AccountAccessDeliveryService,
    InvitationService,
    RecoveryService,
  ],
})
export class AccountAccessModule {}
