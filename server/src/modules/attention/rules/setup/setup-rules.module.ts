import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../../../schools/entities/school.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { SchoolsModule } from '../../../schools/schools.module';
import { OnboardingModule } from '../../../onboarding/onboarding.module';
import { TrialEndingRule } from './trial-ending.rule';
import { SetupIncompleteRule } from './setup-incomplete.rule';
import { CommsProviderMissingRule } from './comms-provider-missing.rule';
import { StaffInvitePendingRule } from './staff-invite-pending.rule';
import { YearNextMissingRule } from './year-next-missing.rule';

/** Rules of category SETUP. TrialEndingRule reads repositories directly (SchoolsModule/TrialModule sit in an import cycle); the others use SchoolsService/OnboardingService. */
@Module({
  imports: [TypeOrmModule.forFeature([School, UserTenant]), SchoolsModule, OnboardingModule],
  providers: [
    TrialEndingRule,
    SetupIncompleteRule,
    CommsProviderMissingRule,
    StaffInvitePendingRule,
    YearNextMissingRule,
  ],
})
export class SetupRulesModule {}
