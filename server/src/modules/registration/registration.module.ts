import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountAccessModule } from '../account-access/account-access.module';
import { OTP_REDIS } from '../account-access/otp.service';
import { AuditModule } from '../audit/audit.module';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { SocialAuthModule } from '../auth/social/social-auth.module';
import { CommunicationsModule } from '../communications/communications.module';
import { ProvisioningService } from '../schools/provisioning/provisioning.service';
import { School } from '../schools/entities/school.entity';
import { TrialModule } from '../schools/trial/trial.module';
import { User } from '../users/entities/user.entity';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { REGISTRATION_REDIS, RegistrationStagingService } from './registration-staging.service';
import { TurnstileService } from './turnstile.service';

/** Public self-service registration [13.3.1]. */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserTenant, School]),
    ConfigModule,
    AuditModule,
    CommunicationsModule,
    TrialModule,
    SocialAuthModule,
    forwardRef(() => AccountAccessModule),
  ],
  controllers: [RegistrationController],
  providers: [
    RegistrationService,
    RegistrationStagingService,
    TurnstileService,
    // The same class the platform console uses; SchoolsModule does not export it, and its only
    // other dependencies (DataSource, AuditService, delivery, Redis) are reachable from here.
    ProvisioningService,
    // The OTP client: same fail-fast settings, one connection instead of a third.
    { provide: REGISTRATION_REDIS, useExisting: OTP_REDIS },
  ],
})
export class RegistrationModule {}
