import { Module } from '@nestjs/common';
import { AcrIncompleteRule } from './acr-incomplete.rule';
import { AdmissionApplicationsPendingRule } from './admission-applications-pending.rule';
import { AdmissionIntakeWindowRule } from './admission-intake-window.rule';
import { LeaveMyRequestDecidedRule } from './leave-my-request-decided.rule';
import { LeaveStaffPendingRule } from './leave-staff-pending.rule';
import { StudentsRecordsIncompleteRule } from './students-records-incomplete.rule';

/** Rules of category OFFICE (DataSource only, no imports needed). */
@Module({
  providers: [
    AdmissionApplicationsPendingRule,
    AdmissionIntakeWindowRule,
    StudentsRecordsIncompleteRule,
    LeaveStaffPendingRule,
    LeaveMyRequestDecidedRule,
    AcrIncompleteRule,
  ],
})
export class OfficeRulesModule {}
