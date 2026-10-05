import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { User } from '../../users/entities/user.entity';
import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../auth.module';
import { UserIdentity } from '../entities/user-identity.entity';
import { GoogleProvider } from './providers/google.provider';
import { SOCIAL_PROVIDERS } from './providers/social-provider';
import { SocialAuthController } from './social-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { SocialIdentityService } from './social-identity.service';
import { SOCIAL_REDIS } from './social-redis';
import { SocialStateService } from './social-state.service';
import { SocialTicketService } from './social-ticket.service';

/** Sign in with Google (and, later, Facebook) [13.2.4]. */
@Module({
  imports: [TypeOrmModule.forFeature([UserIdentity, User]), AuthModule, AuditModule, ConfigModule],
  controllers: [SocialAuthController],
  providers: [
    GoogleProvider,
    {
      provide: SOCIAL_PROVIDERS,
      useFactory: (google: GoogleProvider) => [google],
      inject: [GoogleProvider],
    },
    {
      provide: SOCIAL_REDIS,
      inject: [ConfigService],
      // Same fail-fast settings as OtpService's client: a Redis outage fails
      // the request instead of hanging it.
      useFactory: (config: ConfigService) =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379', {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 1000,
        }),
    },
    SocialStateService,
    SocialTicketService,
    SocialIdentityService,
    SocialAuthService,
  ],
  // The registration flow (#1616/13.3) consumes the ticket and links the identity.
  exports: [SocialTicketService, SocialIdentityService],
})
export class SocialAuthModule {}
