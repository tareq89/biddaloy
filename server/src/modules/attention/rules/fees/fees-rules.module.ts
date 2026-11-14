import { Module } from '@nestjs/common';
import { FeesOverdueRisingRule } from './fees-overdue-rising.rule';
import { FeesRemindersPendingRule } from './fees-reminders-pending.rule';
import { FeesStructureMissingNewYearRule } from './fees-structure-missing-new-year.rule';
import { FeesUnassignedStudentsRule } from './fees-unassigned-students.rule';
import { PaymentProofsWaitingRule } from './payment-proofs-waiting.rule';

/** Rules of category FEES (DataSource only, no imports needed). */
@Module({
  providers: [
    FeesOverdueRisingRule,
    FeesRemindersPendingRule,
    FeesUnassignedStudentsRule,
    PaymentProofsWaitingRule,
    FeesStructureMissingNewYearRule,
  ],
})
export class FeesRulesModule {}
