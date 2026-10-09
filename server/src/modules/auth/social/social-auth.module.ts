import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../auth.module';
import { AccountAccessModule } from '../../account-access/account-access.module';
import { OTP_REDIS } from '../../account-access/otp.service';
import { UserIdentity } from '../entities/user-identity.entity';
import { FacebookProvider } from './providers/facebook.provider';
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
  imports: [
    TypeOrmModule.forFeature([UserIdentity, User]),
    AuthModule,
    // OtpLoginService (which sign-in methods remain) and its Redis client.
    AccountAccessModule,
    AuditModule,
    ConfigModule,
  ],
  controllers: [SocialAuthController],
  providers: [
    GoogleProvider,
    FacebookProvider,
    {
      provide: SOCIAL_PROVIDERS,
      useFactory: (google: GoogleProvider, facebook: FacebookProvider) => [google, facebook],
      inject: [GoogleProvider, FacebookProvider],
    },
    // The OTP client: same fail-fast settings, one connection instead of two.
    { provide: SOCIAL_REDIS, useExisting: OTP_REDIS },
    SocialStateService,
    SocialTicketService,
    SocialIdentityService,
    SocialAuthService,
  ],
  // The registration flow (#1616/13.3) consumes the ticket and links the identity.
  exports: [SocialTicketService, SocialIdentityService],
})
export class SocialAuthModule {}
