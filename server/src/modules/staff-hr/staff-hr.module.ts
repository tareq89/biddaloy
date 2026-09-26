import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Designation } from './entities/designation.entity';
import { StaffHrRecord } from './entities/staff-hr-record.entity';
import { StaffDesignationHistory } from './entities/staff-designation-history.entity';
import { StaffFamilyMember } from './entities/staff-family-member.entity';
import { StaffAddress } from './entities/staff-address.entity';
import { StaffExperience } from './entities/staff-experience.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { DesignationService } from './designation.service';
import { DesignationController } from './designation.controller';
import { StaffHrService } from './staff-hr.service';
import { StaffHrController } from './staff-hr.controller';
import { FamilyController, FamilyMemberRowService } from './family.controller';
import { AddressController, AddressRowService } from './address.controller';
import { ExperienceController, ExperienceRowService } from './experience.controller';

/**
 * [23.2.1 + 23.3] Designation/StaffHrRecord/StaffDesignationHistory: the
 * tenant job-title list, staff job-info records, and the promotion/
 * employment history — plus the first 3 of 7 dynamic-row sections (family,
 * address, experience) built on the repeatable-row replace-on-save pattern
 * (D3). `AuditModule` for `AuditService` (every mutation is audited, D11).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Designation,
      StaffHrRecord,
      StaffDesignationHistory,
      StaffFamilyMember,
      StaffAddress,
      StaffExperience,
      UserTenant,
    ]),
    AuditModule,
  ],
  controllers: [
    DesignationController,
    StaffHrController,
    FamilyController,
    AddressController,
    ExperienceController,
  ],
  providers: [
    DesignationService,
    StaffHrService,
    FamilyMemberRowService,
    AddressRowService,
    ExperienceRowService,
  ],
  exports: [StaffHrService, DesignationService],
})
export class StaffHrModule {}
