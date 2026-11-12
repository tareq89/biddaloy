import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { MfaModule } from '../auth/mfa/mfa.module';
import { PlatformStepUpController } from './platform-step-up.controller';
import { AccountAccessModule } from '../account-access/account-access.module';
import { PlatformApprovalsController } from './approvals/platform-approvals.controller';
import { PlatformApprovalsService } from './approvals/platform-approvals.service';
import { PlatformSettingsController } from './approvals/platform-settings.controller';
import { PlatformSettingsService } from './approvals/platform-settings.service';
import { TwoPersonGuard } from './approvals/two-person.guard';
import { PlatformOwnersController } from './owners/platform-owners.controller';
import { PlatformOwnersService } from './owners/platform-owners.service';
import { PlatformAdmin } from './entities/platform-admin.entity';
import { PlatformApproval } from './entities/platform-approval.entity';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformHomeService } from './platform-home.service';
import { OwnerSeedingService } from './owner-seeding.service';
import { PlatformCutoverService } from './platform-cutover.service';

/**
 * [Epic 98] Platform owners, their guard, the platform home school, boot-time owner seeding.
 * `TenantStatusService` comes from the global `TenantStatusModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformAdmin, PlatformApproval, PlatformSetting]),
    AuditModule,
    MfaModule,
    AccountAccessModule,
  ],
  controllers: [
    PlatformStepUpController,
    PlatformApprovalsController,
    PlatformSettingsController,
    PlatformOwnersController,
  ],
  providers: [
    PlatformAdminGuard,
    PlatformAdminService,
    PlatformHomeService,
    OwnerSeedingService,
    PlatformCutoverService, // runs itself on boot, after OwnerSeedingService (provider order)
    PlatformApprovalsService,
    PlatformSettingsService,
    PlatformOwnersService,
    TwoPersonGuard,
  ],
  exports: [
    PlatformAdminGuard,
    PlatformAdminService,
    PlatformHomeService,
    OwnerSeedingService,
    PlatformApprovalsService,
    PlatformSettingsService,
    TwoPersonGuard,
  ],
})
export class PlatformIdentityModule {}
