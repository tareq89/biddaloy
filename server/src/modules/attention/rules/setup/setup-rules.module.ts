import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../../../schools/entities/school.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { TrialEndingRule } from './trial-ending.rule';

/** Rules of category SETUP. Not importing TrialModule/SchoolsModule: they sit in an import cycle. */
@Module({
  imports: [TypeOrmModule.forFeature([School, UserTenant])],
  providers: [TrialEndingRule],
})
export class SetupRulesModule {}
