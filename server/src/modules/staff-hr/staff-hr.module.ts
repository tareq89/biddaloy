import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Designation } from './entities/designation.entity';
import { StaffHrRecord } from './entities/staff-hr-record.entity';
import { StaffDesignationHistory } from './entities/staff-designation-history.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { DesignationService } from './designation.service';
import { DesignationController } from './designation.controller';
import { StaffHrService } from './staff-hr.service';
import { StaffHrController } from './staff-hr.controller';

/**
 * [23.2.1] Designation/StaffHrRecord/StaffDesignationHistory: the tenant
 * job-title list, staff job-info records, and the promotion/employment
 * history. `AuditModule` for `AuditService` (every mutation is audited,
 * D11).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Designation, StaffHrRecord, StaffDesignationHistory, UserTenant]),
    AuditModule,
  ],
  controllers: [DesignationController, StaffHrController],
  providers: [DesignationService, StaffHrService],
  exports: [StaffHrService, DesignationService],
})
export class StaffHrModule {}
