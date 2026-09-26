import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../src/modules/academics/entities/teacher-class-section.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { ClassSubject } from '../src/modules/academics/entities/class-subject.entity';
import { CalendarEvent } from '../src/modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../src/modules/calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from '../src/modules/calendar/entities/academic-term.entity';
import { PublicHolidaySet } from '../src/modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../src/modules/calendar/entities/public-holiday-entry.entity';
import { CalendarFeedToken } from '../src/modules/calendar/entities/calendar-feed-token.entity';
import { AttendanceSession } from '../src/modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../src/modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../src/modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../src/modules/attendance/entities/attendance-device-event.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { AuthToken } from '../src/modules/account-access/entities/auth-token.entity';
import { CommunicationLog } from '../src/modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../src/modules/communications/entities/reminder-batch.entity';
import { SmsCreditLedger } from '../src/modules/communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditBalance } from '../src/modules/communications/credits/entities/sms-credit-balance.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { DiscountRule } from '../src/modules/fees/entities/discount-rule.entity';
import { Payment } from '../src/modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../src/modules/fees/entities/payment-allocation.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { FeeGeneration } from '../src/modules/fees/entities/fee-generation.entity';
import { RecurringSchedule } from '../src/modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../src/modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from '../src/modules/fees/entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from '../src/modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from '../src/modules/fees/entities/wallet-transaction.entity';
import { Invoice } from '../src/modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from '../src/modules/invoices/entities/invoice-share-token.entity';
import { School } from '../src/modules/schools/entities/school.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { PushSubscription } from '../src/modules/push/entities/push-subscription.entity';
import { WorkbookJob } from '../src/modules/workbook/jobs/workbook-job.entity';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../src/modules/grading/entities/grading-band.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { MarkGrid } from '../src/modules/exams/entities/mark-grid.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { ResultSubject } from '../src/modules/exams/entities/result-subject.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { StudentSubjectChoice } from '../src/modules/students/entities/student-subject-choice.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { PeriodSlot } from '../src/modules/routines/entities/period-slot.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Routine } from '../src/modules/routines/entities/routine.entity';
import { RoutineSlot } from '../src/modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../src/modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../src/modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../src/modules/routines/entities/routine-change-request.entity';
import { Homework } from '../src/modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../src/modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../src/modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../src/modules/homework/entities/syllabus-topic.entity';
import { AdmissionIntake } from '../src/modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../src/modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from '../src/modules/admission/entities/admission-evaluation.entity';
import { PromotionRun } from '../src/modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../src/modules/promotions/entities/promotion-entry.entity';

export const ALL_ENTITIES = [
  AcademicYear,
  Class,
  ClassSection,
  Teacher,
  TeacherClassSection,
  Subject,
  ClassSubject,
  CalendarEvent,
  CalendarEventClass,
  AcademicTerm,
  PublicHolidaySet,
  PublicHolidayEntry,
  CalendarFeedToken,
  AttendanceSession,
  AttendanceRecord,
  AttendanceDevice,
  AttendanceDeviceEvent,
  AuditLog,
  UserTenant,
  AuthToken,
  CommunicationLog,
  ReminderBatch,
  SmsCreditLedger,
  SmsCreditBalance,
  FeeStructure,
  DiscountRule,
  Payment,
  PaymentAllocation,
  StudentFee,
  FeeGeneration,
  RecurringSchedule,
  RecurringScheduleStructure,
  RecurringScheduleExclusion,
  StudentWallet,
  WalletTransaction,
  Invoice,
  InvoiceShareToken,
  School,
  Student,
  Guardian,
  Enrollment,
  User,
  PushSubscription,
  WorkbookJob,
  GradingScale,
  GradingBand,
  Exam,
  ExamComponent,
  Mark,
  MarkGrid,
  Result,
  ResultSubject,
  ExamSchedule,
  StudentSubjectChoice,
  Shift,
  PeriodSlot,
  Room,
  Routine,
  RoutineSlot,
  RoutineSlotTeacher,
  RoutineSubstitution,
  RoutineChangeRequest,
  Homework,
  HomeworkAssignment,
  HomeworkSubmission,
  SyllabusTopic,
  AdmissionIntake,
  AdmissionApplicant,
  AdmissionEvaluation,
  PromotionRun,
  PromotionEntry,
];
