import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeavePolicy } from './entities/leave-policy.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { AuditModule } from '../audit/audit.module';
import { LeaveService } from './leave.service';
import { LeaveController } from './leave.controller';

/** [36.3] Leave requests + approval + per-type quotas. See
 * `staff-attendance.module.ts` for the pattern this mirrors. */
@Module({
  imports: [TypeOrmModule.forFeature([LeaveRecord, LeavePolicy, StaffProfile]), AuditModule],
  providers: [LeaveService],
  controllers: [LeaveController],
  exports: [TypeOrmModule, LeaveService],
})
export class LeaveModule {}
