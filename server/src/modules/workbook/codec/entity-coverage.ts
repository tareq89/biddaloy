import type { EntityTarget } from 'typeorm';
import { CalendarEventClass } from '../../calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from '../../calendar/entities/academic-term.entity';
import { PublicHolidaySet } from '../../calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../../calendar/entities/public-holiday-entry.entity';
import { CalendarFeedToken } from '../../calendar/entities/calendar-feed-token.entity';
import { AttendanceSession } from '../../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../../attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../../attendance/entities/attendance-device-event.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { AuthToken } from '../../account-access/entities/auth-token.entity';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { ReminderBatch } from '../../communications/entities/reminder-batch.entity';
import { SmsCreditLedger } from '../../communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditBalance } from '../../communications/credits/entities/sms-credit-balance.entity';
import { DiscountRule } from '../../fees/entities/discount-rule.entity';
import { FeeGeneration } from '../../fees/entities/fee-generation.entity';
import { RecurringSchedule } from '../../fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../../fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from '../../fees/entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from '../../fees/entities/student-wallet.entity';
import { WalletTransaction } from '../../fees/entities/wallet-transaction.entity';
import { InvoiceShareToken } from '../../invoices/entities/invoice-share-token.entity';
import { PushSubscription } from '../../push/entities/push-subscription.entity';
import { WorkbookJob } from '../jobs/workbook-job.entity';
import { Exam } from '../../exams/entities/exam.entity';
import { ExamComponent } from '../../exams/entities/exam-component.entity';
import { Mark } from '../../exams/entities/mark.entity';
import { MarkGrid } from '../../exams/entities/mark-grid.entity';
import { Result } from '../../exams/entities/result.entity';
import { ResultSubject } from '../../exams/entities/result-subject.entity';
import { StudentSubjectChoice } from '../../students/entities/student-subject-choice.entity';

/**
 * Entities that `registry.completeness.spec.ts` allows to have no workbook
 * tab, each with a one-line reason — the same convention `TabSpec.excluded`
 * uses for a column deliberately left out of a tab.
 *
 * Two different reasons show up here:
 *
 * 1. Platform-scoped or regenerable technical state: not a tenant's data to
 *    back up (a queue record, a credential, an append-only log, a platform
 *    table with no `tenant_id` at all).
 * 2. A genuine gap: tenant-scoped business data with no tab today. These
 *    are *not* silently accepted — each reason links the GitHub issue that
 *    tracks adding a tab, per #835's acceptance criteria.
 */
export const ENTITY_COVERAGE_EXEMPT: ReadonlyMap<EntityTarget<unknown>, string> = new Map<
  EntityTarget<unknown>,
  string
>([
  // --- Platform-scoped / regenerable technical state ---
  [
    WorkbookJob,
    'Job/queue record for the workbook module itself — backing it up would be circular.',
  ],
  [AuditLog, 'Append-only audit trail, not tenant content to restore.'],
  [AuthToken, 'Password-reset / email-verification / refresh token — a regenerable credential.'],
  [CalendarFeedToken, 'Regenerable calendar-feed credential, not user content.'],
  [PushSubscription, 'Regenerable browser push-subscription endpoint, not user content.'],
  [InvoiceShareToken, 'Regenerable share-link token, not user content.'],
  [PublicHolidaySet, 'Platform table: no tenant_id by design (calendar D10).'],
  [PublicHolidayEntry, 'Platform table: no tenant_id by design (calendar D10).'],
  [
    CommunicationLog,
    'Append-only delivery log of already-sent messages, not live state to restore.',
  ],
  [ReminderBatch, 'Operational batch-run record, not live state to restore.'],

  // --- Genuine gaps: tenant-scoped business data with no tab yet ---
  // Tracked in https://github.com/tareq89/biddaloy/issues/856
  [AcademicTerm, 'Tenant-scoped term config, no tab yet — tracked in #856.'],
  [CalendarEventClass, 'Tenant-scoped calendar-event/class link, no tab yet — tracked in #856.'],
  [AttendanceSession, 'Tenant-scoped attendance session data, no tab yet — tracked in #856.'],
  [AttendanceRecord, 'Tenant-scoped per-student attendance, no tab yet — tracked in #856.'],
  [AttendanceDevice, 'Tenant-scoped device config, no tab yet — tracked in #856.'],
  [AttendanceDeviceEvent, 'Tenant-scoped device event log, no tab yet — tracked in #856.'],
  [UserTenant, 'Tenant-scoped role membership, no tab yet — tracked in #856.'],
  [SmsCreditLedger, 'Tenant-scoped SMS credit ledger, no tab yet — tracked in #856.'],
  [SmsCreditBalance, 'Tenant-scoped SMS credit balance, no tab yet — tracked in #856.'],
  [DiscountRule, 'Tenant-scoped fee discount rule, no tab yet — tracked in #856.'],
  [FeeGeneration, 'Tenant-scoped fee generation run record, no tab yet — tracked in #856.'],
  [RecurringSchedule, 'Tenant-scoped recurring fee schedule, no tab yet — tracked in #856.'],
  [
    RecurringScheduleStructure,
    'Tenant-scoped recurring schedule structure line, no tab yet — tracked in #856.',
  ],
  [
    RecurringScheduleExclusion,
    'Tenant-scoped recurring schedule exclusion date, no tab yet — tracked in #856.',
  ],
  [StudentWallet, 'Tenant-scoped student wallet balance, no tab yet — tracked in #856.'],
  [WalletTransaction, 'Tenant-scoped wallet transaction history, no tab yet — tracked in #856.'],

  // [19.2.1] Epic 19.0's exams/marks/results spine — workbook tabs are
  // 19.10.1's job (#906) by design, per the epic's "Backup & restore
  // coverage" section, so these land here until that ticket adds them.
  [Exam, 'Tenant-scoped exam sitting, workbook tab lands in 19.10.1 — tracked in #906.'],
  [
    ExamComponent,
    'Tenant-scoped exam-subject component, workbook tab lands in 19.10.1 — tracked in #906.',
  ],
  [Mark, 'Tenant-scoped student mark, workbook tab lands in 19.10.1 — tracked in #906.'],
  [
    MarkGrid,
    'Tenant-scoped marks-entry grid state, workbook tab lands in 19.10.1 — tracked in #906.',
  ],
  [Result, 'Tenant-scoped computed result, workbook tab lands in 19.10.1 — tracked in #906.'],
  [
    ResultSubject,
    'Tenant-scoped per-subject result line, workbook tab lands in 19.10.1 — tracked in #906.',
  ],
  [
    StudentSubjectChoice,
    'Tenant-scoped fourth-subject choice, workbook tab lands in 19.10.1 — tracked in #906.',
  ],
  // Epic 21.0 (class routine/timetable)'s eight entities — shifts,
  // period_slots, rooms, routines, routine_slots, routine_slot_teachers,
  // routine_substitutions, routine_change_requests — all got a workbook
  // tab in [21.11.1]. No exemption entries left for them.
]);
