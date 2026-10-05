import type { INestApplicationContext } from '@nestjs/common';
import { Between, DataSource, In, type Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createScriptAppContext } from './script-app-context';
import { User } from '../modules/users/entities/user.entity';
import { School } from '../modules/schools/entities/school.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';
import { Subject } from '../modules/academics/entities/subject.entity';
import { CalendarEvent } from '../modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../modules/calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from '../modules/calendar/entities/academic-term.entity';
import { PublicHolidaySet } from '../modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../modules/calendar/entities/public-holiday-entry.entity';
import { Teacher } from '../modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../modules/academics/entities/teacher-class-section.entity';
import { AttendanceSession } from '../modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../modules/attendance/entities/attendance-device.entity';
import { ClassSubject } from '../modules/academics/entities/class-subject.entity';
import { GradingScale } from '../modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../modules/grading/entities/grading-band.entity';
import { Exam } from '../modules/exams/entities/exam.entity';
import { ExamComponent } from '../modules/exams/entities/exam-component.entity';
import { Mark } from '../modules/exams/entities/mark.entity';
import { MarkGrid } from '../modules/exams/entities/mark-grid.entity';
import { Result } from '../modules/exams/entities/result.entity';
import { ResultSubject } from '../modules/exams/entities/result-subject.entity';
import { ExamSchedule } from '../modules/exams/entities/exam-schedule.entity';
import { Homework } from '../modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../modules/homework/entities/syllabus-topic.entity';
import { AdmissionIntake } from '../modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../modules/admission/entities/admission-applicant.entity';
import { AdmissionApplicantStatus } from '@biddaloy/shared';
import { Enrollment } from '../modules/students/entities/enrollment.entity';
import { PromotionRun } from '../modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../modules/promotions/entities/promotion-entry.entity';
import { Program } from '../modules/programs/entities/program.entity';
import { ProgramMilestone } from '../modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../modules/programs/entities/milestone-achievement.entity';
import { FeeStructure } from '../modules/fees/entities/fee-structure.entity';
import { FineRule } from '../modules/fees/entities/fine-rule.entity';
import { RecurringSchedule } from '../modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../modules/fees/entities/recurring-schedule-structure.entity';
import { StaffProfile } from '../modules/staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceSession } from '../modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeavePolicy } from '../modules/leave/entities/leave-policy.entity';
import { LeaveRecord } from '../modules/leave/entities/leave-record.entity';
import { DEV_SEED_PLATFORM_TENANT_ID } from '../config/env.validation';
import { seedAccounts, ensureTrialDemoSeed, TRIAL_DEMO } from './seed.accounts';
import { Shift } from '../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../modules/routines/entities/period-slot.entity';
import { Room } from '../modules/routines/entities/room.entity';
import { Routine } from '../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../modules/routines/entities/routine-change-request.entity';
import {
  ensureAttendancePeriodSetting,
  ensureDemoOrganisation,
  ensurePresetDemoSeed,
  type PrintDemoSeedPorts,
  type PrintHistoryDemoSeedPorts,
} from './seed.util';
import { ensureStudentLifecycleSeed } from './seed.lifecycle';
import { ensureEvaluationsSeed } from './seed.evaluations';
import { AcrAssessment } from '../modules/acr/entities/acr-assessment.entity';
import { AcrCriterion } from '../modules/acr/entities/acr-criterion.entity';
import { AcrFormVersion } from '../modules/acr/entities/acr-form-version.entity';
import { AcrScore } from '../modules/acr/entities/acr-score.entity';
import { StaffIncident } from '../modules/incidents/entities/staff-incident.entity';
import { Survey } from '../modules/surveys/entities/survey.entity';
import { SurveyAnswer } from '../modules/surveys/entities/survey-answer.entity';
import { SurveyQuestion } from '../modules/surveys/entities/survey-question.entity';
import { SurveyResponse } from '../modules/surveys/entities/survey-response.entity';
import { SurveyTarget } from '../modules/surveys/entities/survey-target.entity';
import { StudentLifecycleEvent } from '../modules/students/entities/student-lifecycle-event.entity';
import { StudentNote } from '../modules/students/entities/student-note.entity';
import { StudentPublicExam } from '../modules/students/entities/student-public-exam.entity';
import { PrintTemplatesService } from '../modules/print/templates/print-templates.service';
import { PrintJobsService } from '../modules/print/jobs/print-jobs.service';
import { PrintHistoryService } from '../modules/print/jobs/print-history.service';
import { StorageService } from '../modules/storage/storage.service';
import { SeatPlan } from '../modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from '../modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from '../modules/seat-plans/entities/seat-allocation.entity';
import { StudentFee } from '../modules/fees/entities/student-fee.entity';
import { FinesService } from '../modules/fees/fines/fines.service';
import { FineSweepService } from '../modules/fees/fines/fine-sweep.service';
import { PaymentAllocationService } from '../modules/fees/payment-allocation.service';
import {
  AttendanceSessionState,
  AttendanceStatus,
  DuplicateStrategy,
  FeeStatus,
  PaymentAllocationType,
  PaymentMethod,
} from '@biddaloy/shared';

export { seedAccounts, type SeedAccountRepositories } from './seed.accounts';

export async function seed() {
  // [9.11] `ensureAttendanceSeed` writes a fixed, repository-known
  // `SEED_DEVICE_KEY` onto an ACTIVE, roster-enabled attendance device —
  // and every other seed account in this file uses one shared password
  // from `SEED_ADMIN_PASSWORD`. None of that is safe against a real
  // database. Checked before booting `AppModule` at all, so a mistaken
  // invocation against production fails immediately rather than after
  // paying for a full Nest bootstrap.
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'Refusing to run the seed script with NODE_ENV=production — it writes ' +
        'known, repository-visible credentials (SEED_ADMIN_PASSWORD, the fixed ' +
        'attendance device key) into the database.',
    );
    process.exit(1);
  }

  const app = await createScriptAppContext();
  const dataSource = app.get(DataSource);

  const userRepository = dataSource.getRepository(User);
  const schoolRepository = dataSource.getRepository(School);
  const userTenantRepository = dataSource.getRepository(UserTenant);

  const adminEmail = 'admin@school.com';

  // Required unconditionally now, not just when creating/restoring the
  // SUPER_ADMIN — `ensureRoleTestUsers` below needs it too, on every run:
  // a re-run against an already-seeded dev DB may still be the first run
  // to add the six [8.9.6] role-test accounts.
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length === 0) {
    console.error(
      'SEED_ADMIN_PASSWORD environment variable is required but was not set or is empty.',
    );
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Ensure the default school exists — every account below is a member of
  // it. `context.guard.ts`'s `ContextGuard.resolvePlatformTenantId()`
  // discovers this school by its slug (`default-school`) at request time
  // outside production, so this school's SUPER_ADMIN is recognized as a
  // genuine platform admin however this row got its id — no fixed id needs
  // to line up between this script and the guard. `DEV_SEED_PLATFORM_TENANT_ID`
  // below is only this script's own fallback id for a from-scratch create,
  // not something anything else depends on.
  //
  // Looked up by id as well as slug: `server/test/reset-order.ts` inserts a
  // school with this same fixed id under the slug `test-school`, so a
  // slug-only check would miss it and then fail the insert on a primary key
  // conflict for anyone running the seed against a database that has had the
  // test fixtures applied. On a clean database both lookups miss and the
  // school is created exactly as before.
  let school = await schoolRepository.findOne({
    where: [{ slug: 'default-school' }, { id: DEV_SEED_PLATFORM_TENANT_ID }],
  });
  if (!school) {
    school = schoolRepository.create({
      id: DEV_SEED_PLATFORM_TENANT_ID,
      name: 'Default School',
      slug: 'default-school',
    });
    await schoolRepository.save(school);
    console.log(`Created default school (${school.id}).`);
  }

  // [33.5.1] `DEMO_CLASSES` below writes `shift`/`version`/`group_name`
  // straight through the repository (bypassing `ClassService`'s vocabulary
  // check), so the tenant's own vocabulary must exist first — on both the
  // freshly-created and the already-existing-school path. Idempotent: does
  // nothing once the tenant has any `organisation` vocabulary, hand-edited
  // or not.
  if (ensureDemoOrganisation(school)) {
    await schoolRepository.save(school);
    console.log(`Set organisation vocabulary on ${school.name}.`);
  }

  // [41.2.c] Period attendance on for the demo school (the switch is off by
  // default); a hand-set value survives a re-run.
  if (ensureAttendancePeriodSetting(school)) {
    await schoolRepository.save(school);
    console.log(`Turned period attendance on for ${school.name}.`);
  }

  await seedAccounts(
    {
      userRepository,
      schoolRepository,
      userTenantRepository,
      academicYearRepository: dataSource.getRepository(AcademicYear),
      classRepository: dataSource.getRepository(Class),
      classSectionRepository: dataSource.getRepository(ClassSection),
      studentRepository: dataSource.getRepository(Student),
      guardianRepository: dataSource.getRepository(Guardian),
      subjectRepository: dataSource.getRepository(Subject),
      schoolHolidayRepository: dataSource.getRepository(CalendarEvent),
      academicTermRepository: dataSource.getRepository(AcademicTerm),
      calendarEventClassRepository: dataSource.getRepository(CalendarEventClass),
      publicHolidaySetRepository: dataSource.getRepository(PublicHolidaySet),
      publicHolidayEntryRepository: dataSource.getRepository(PublicHolidayEntry),
      teacherRepository: dataSource.getRepository(Teacher),
      teacherClassSectionRepository: dataSource.getRepository(TeacherClassSection),
      attendanceSessionRepository: dataSource.getRepository(AttendanceSession),
      attendanceRecordRepository: dataSource.getRepository(AttendanceRecord),
      attendanceDeviceRepository: dataSource.getRepository(AttendanceDevice),
      classSubjectRepository: dataSource.getRepository(ClassSubject),
      gradingScaleRepository: dataSource.getRepository(GradingScale),
      gradingBandRepository: dataSource.getRepository(GradingBand),
      shiftRepository: dataSource.getRepository(Shift),
      periodSlotRepository: dataSource.getRepository(PeriodSlot),
      roomRepository: dataSource.getRepository(Room),
      routineRepository: dataSource.getRepository(Routine),
      routineSlotRepository: dataSource.getRepository(RoutineSlot),
      routineSlotTeacherRepository: dataSource.getRepository(RoutineSlotTeacher),
      routineSubstitutionRepository: dataSource.getRepository(RoutineSubstitution),
      routineChangeRequestRepository: dataSource.getRepository(RoutineChangeRequest),
      examRepository: dataSource.getRepository(Exam),
      examComponentRepository: dataSource.getRepository(ExamComponent),
      markGridRepository: dataSource.getRepository(MarkGrid),
      markRepository: dataSource.getRepository(Mark),
      resultRepository: dataSource.getRepository(Result),
      resultSubjectRepository: dataSource.getRepository(ResultSubject),
      examScheduleRepository: dataSource.getRepository(ExamSchedule),
      homeworkRepository: dataSource.getRepository(Homework),
      homeworkAssignmentRepository: dataSource.getRepository(HomeworkAssignment),
      homeworkSubmissionRepository: dataSource.getRepository(HomeworkSubmission),
      syllabusTopicRepository: dataSource.getRepository(SyllabusTopic),
      enrollmentRepository: dataSource.getRepository(Enrollment),
      promotionRunRepository: dataSource.getRepository(PromotionRun),
      promotionEntryRepository: dataSource.getRepository(PromotionEntry),
      seatPlanRepository: dataSource.getRepository(SeatPlan),
      seatPlanScheduleRepository: dataSource.getRepository(SeatPlanSchedule),
      seatAllocationRepository: dataSource.getRepository(SeatAllocation),
      programRepository: dataSource.getRepository(Program),
      programMilestoneRepository: dataSource.getRepository(ProgramMilestone),
      programEnrollmentRepository: dataSource.getRepository(ProgramEnrollment),
      milestoneAchievementRepository: dataSource.getRepository(MilestoneAchievement),
      feeStructureRepository: dataSource.getRepository(FeeStructure),
      fineRuleRepository: dataSource.getRepository(FineRule),
      recurringScheduleRepository: dataSource.getRepository(RecurringSchedule),
      recurringScheduleStructureRepository: dataSource.getRepository(RecurringScheduleStructure),
      staffProfileRepository: dataSource.getRepository(StaffProfile),
      leavePolicyRepository: dataSource.getRepository(LeavePolicy),
      staffAttendanceSessionRepository: dataSource.getRepository(StaffAttendanceSession),
      staffAttendanceRecordRepository: dataSource.getRepository(StaffAttendanceRecord),
      leaveRecordRepository: dataSource.getRepository(LeaveRecord),
    },
    school,
    adminEmail,
    passwordHash,
    printPorts(app, school.id, adminEmail, userRepository),
  );

  // [27.11] Sample admission intake + applicants, so local dev has
  // something to look at on the new People › Admissions screens without
  // manually submitting a public application first. Idempotent on
  // `title`, same "find-or-create" shape as the school block above.
  await ensureAdmissionSeed(dataSource, school);

  // [38.2.5] Fine activity: 3 manual fines, one month's attendance-fine
  // sweep, a waive and a partial payment — so every FeeStatus shows up.
  await ensureFineActivitySeed(app, dataSource, school);

  // [39.1.4] Lifecycle events, notes, public exams + the five student columns.
  const lifecycleAdmin = await userRepository.findOne({ where: { email: adminEmail } });
  if (lifecycleAdmin) {
    await ensureStudentLifecycleSeed(
      {
        studentRepository: dataSource.getRepository(Student),
        enrollmentRepository: dataSource.getRepository(Enrollment),
        academicYearRepository: dataSource.getRepository(AcademicYear),
        lifecycleEventRepository: dataSource.getRepository(StudentLifecycleEvent),
        noteRepository: dataSource.getRepository(StudentNote),
        publicExamRepository: dataSource.getRepository(StudentPublicExam),
      },
      school.id,
      lifecycleAdmin.id,
    );

    // [28.1.4] Default ACR form, demo ACRs, survey, incidents, note rating.
    await ensureEvaluationsSeed(
      {
        userRepository,
        userTenantRepository,
        academicYearRepository: dataSource.getRepository(AcademicYear),
        subjectRepository: dataSource.getRepository(Subject),
        teacherRepository: dataSource.getRepository(Teacher),
        studentRepository: dataSource.getRepository(Student),
        noteRepository: dataSource.getRepository(StudentNote),
        formVersionRepository: dataSource.getRepository(AcrFormVersion),
        criterionRepository: dataSource.getRepository(AcrCriterion),
        assessmentRepository: dataSource.getRepository(AcrAssessment),
        scoreRepository: dataSource.getRepository(AcrScore),
        incidentRepository: dataSource.getRepository(StaffIncident),
        surveyRepository: dataSource.getRepository(Survey),
        surveyQuestionRepository: dataSource.getRepository(SurveyQuestion),
        surveyTargetRepository: dataSource.getRepository(SurveyTarget),
        surveyResponseRepository: dataSource.getRepository(SurveyResponse),
        surveyAnswerRepository: dataSource.getRepository(SurveyAnswer),
      },
      school.id,
      lifecycleAdmin.id,
    );
  }

  // [35.5.5] Unapplied tenant for walking the preset flow (after the demo seeds).
  await ensurePresetDemoSeed(dataSource.manager, passwordHash);

  // [13.1.4] A school mid-trial with its admin and an invited teacher.
  await ensureTrialDemoSeed(dataSource.manager, passwordHash);

  // [13.1.4] Every other demo school is an established, onboarded one in BD;
  // only fills NULLs, so a hand-set value survives a re-run.
  await schoolRepository
    .createQueryBuilder()
    .update(School)
    .set({ country_code: 'BD' })
    .where('country_code IS NULL AND slug <> :slug', { slug: TRIAL_DEMO.slug })
    .execute();
  await schoolRepository
    .createQueryBuilder()
    .update(School)
    .set({ onboarding: () => `jsonb_build_object('finished_at', now())` })
    .where('onboarding IS NULL AND slug <> :slug', { slug: TRIAL_DEMO.slug })
    .execute();

  await app.close();
}

/** [27.11] One open intake against the first class section this school has
 * (created by `seedAccounts`' `DEMO_CLASSES`), plus a handful of applicants
 * spanning every status — PENDING/SHORTLISTED/ADMITTED/REJECTED — so the
 * admissions screens aren't empty on a fresh `yarn seed`. */
async function ensureAdmissionSeed(dataSource: DataSource, school: School) {
  const intakeRepository = dataSource.getRepository(AdmissionIntake);
  const applicantRepository = dataSource.getRepository(AdmissionApplicant);
  const classSectionRepository = dataSource.getRepository(ClassSection);

  const title = 'Class 1 Admission 2026';
  const section = await classSectionRepository.findOne({ where: { tenant_id: school.id } });
  if (!section) {
    console.warn('No class section found — skipping admission intake seed.');
    return;
  }

  // A window centered on "today" rather than a fixed 2026 range, so the
  // sample intake stays open (and the public flow stays demoable) no
  // matter when `yarn seed` actually runs.
  const openDate = new Date();
  openDate.setFullYear(openDate.getFullYear() - 1);
  const closeDate = new Date();
  closeDate.setFullYear(closeDate.getFullYear() + 1);
  const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);

  let intake = await intakeRepository.findOne({
    where: { tenant_id: school.id, class_section_id: section.id, title },
  });
  if (!intake) {
    intake = intakeRepository.create({
      tenant_id: school.id,
      class_section_id: section.id,
      title,
      seat_count: 30,
      open_date: toDateOnly(openDate),
      close_date: toDateOnly(closeDate),
      required_document_types: ['PHOTO'],
    });
    await intakeRepository.save(intake);
    console.log(`Created admission intake "${title}" (${intake.id}).`);
  } else if (intake.close_date < toDateOnly(new Date())) {
    // Re-running the seed against an older, now-expired sample intake —
    // extend it instead of leaving it permanently closed.
    intake.open_date = toDateOnly(openDate);
    intake.close_date = toDateOnly(closeDate);
    await intakeRepository.save(intake);
    console.log(`Extended admission intake "${title}" (${intake.id}) — it had expired.`);
  }

  const applicants: Array<{
    name: string;
    phone: string;
    status: AdmissionApplicantStatus;
  }> = [
    { name: 'Rahim Ahmed', phone: '01711000001', status: AdmissionApplicantStatus.PENDING },
    { name: 'Karim Hossain', phone: '01711000002', status: AdmissionApplicantStatus.SHORTLISTED },
    { name: 'Fatema Begum', phone: '01711000003', status: AdmissionApplicantStatus.ADMITTED },
    { name: 'Nusrat Jahan', phone: '01711000004', status: AdmissionApplicantStatus.REJECTED },
  ];

  for (const [index, a] of applicants.entries()) {
    const existing = await applicantRepository.findOne({
      where: { tenant_id: school.id, intake_id: intake.id, guardian_phone: a.phone },
    });
    if (existing) continue;

    const referenceNumber = `ADM-2026-${String(index + 1).padStart(6, '0')}`;
    await applicantRepository.save(
      applicantRepository.create({
        tenant_id: school.id,
        intake_id: intake.id,
        reference_number: referenceNumber,
        applicant_name: a.name,
        date_of_birth: '2019-03-15',
        gender: 'MALE',
        guardian_name: `Guardian of ${a.name}`,
        guardian_phone: a.phone,
        guardian_email: null,
        home_address: null,
        documents: [],
        status: a.status,
      }),
    );
    console.log(`Created admission applicant "${a.name}" (${a.status}).`);
  }
}

/**
 * [38.2.5] Fine activity for the demo tenant: 3 manual fines (damage,
 * ID card, uniform) logged through the real `FinesService`, one
 * attendance-fine sweep for last month through the real `FineSweepService`
 * (seeding a handful of ABSENT marks first if none exist), then a waive on
 * one bill and a partial payment on another through the real
 * `PaymentAllocationService` — so `PENDING`/`PARTIALLY_PAID`/`PAID`/
 * `WAIVED` all show up on the fines list. Reuses the real services rather
 * than hand-rolling bill math, same as every other `ensure*` helper reuses
 * whatever service already owns that logic. Idempotent — everything here
 * is looked up by a distinguishing field before it writes anything.
 *
 * Depends on `ensureFineSeedData` (`seed.accounts.ts`) having already run
 * for this school — skips with a warning if the fine fee structures it
 * creates aren't there yet.
 */
async function ensureFineActivitySeed(
  app: INestApplicationContext,
  dataSource: DataSource,
  school: School,
): Promise<void> {
  const feeStructureRepo = dataSource.getRepository(FeeStructure);
  const studentFeeRepo = dataSource.getRepository(StudentFee);
  const studentRepo = dataSource.getRepository(Student);
  const attendanceSessionRepo = dataSource.getRepository(AttendanceSession);
  const attendanceRecordRepo = dataSource.getRepository(AttendanceRecord);
  const userRepo = dataSource.getRepository(User);

  const [damageStructure, idCardStructure, uniformStructure, absentStructure] = await Promise.all([
    feeStructureRepo.findOne({ where: { tenant_id: school.id, name: 'Property damage' } }),
    feeStructureRepo.findOne({ where: { tenant_id: school.id, name: 'ID card replacement' } }),
    feeStructureRepo.findOne({ where: { tenant_id: school.id, name: 'Uniform' } }),
    feeStructureRepo.findOne({ where: { tenant_id: school.id, name: 'Absent fine' } }),
  ]);
  if (!damageStructure || !idCardStructure || !uniformStructure || !absentStructure) {
    console.warn('Fine structures not found — skipping fine activity seed.');
    return;
  }

  const students = await studentRepo.find({
    where: { tenant_id: school.id },
    // `id` breaks ties between same-roll-number students in different
    // sections so a rerun always picks the same two students.
    order: { roll_number: 'ASC', id: 'ASC' },
    take: 2,
  });
  if (students.length < 2) {
    console.warn('Fewer than 2 students — skipping fine activity seed.');
    return;
  }
  const [studentOne, studentTwo] = students;

  const adminUser = await userRepo.findOne({ where: { email: 'admin@school.com' } });
  if (!adminUser) {
    console.warn('Default admin user not found — skipping fine activity seed.');
    return;
  }

  const finesService = app.get(FinesService);
  const fineSweepService = app.get(FineSweepService);
  const paymentAllocationService = app.get(PaymentAllocationService);
  // A fixed anchor inside `DEMO_ACADEMIC_YEAR` (2026-01-01..2026-12-31),
  // not the real "today" — `FinesService.logFine`/`FineSweepService.generate`
  // both reject an incident/target month outside the academic year, so
  // deriving these dates from the wall clock would make `yarn seed` start
  // throwing every January once "3 months ago" or "today" drifts past
  // 2026-12-31. Same fixed-anchor pattern as `ATTENDANCE_SEED_MONTH`.
  // Early enough in the year that `monthsAgo(3)` (see below) still lands
  // inside the academic year, and early enough in 2026 that it — and every
  // bill period derived from it below — is always a past month by the time
  // this runs, so `allocationTypeFor` can hard-code `DUE` without racing
  // the real wall clock (`FinesService.logFine` itself still rejects a
  // future incident_date, which is why this can't be later than today).
  const today = '2026-04-05';

  // --- 1. Three manual fines, logged through the real FinesService, each
  // in a different past month — one bill each, no two ever fall in the
  // same month (see step 3: `PaymentAllocationService` enforces FIFO by
  // (year, month), and two same-month bills sort in an unspecified order
  // against each other, making "settle exactly this one, not that one"
  // undependable — a distinct month per bill sidesteps that entirely).
  const monthsAgo = (n: number): string => {
    const d = new Date(`${today}T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() - n, 5); // the 5th, safe on every month length
    return d.toISOString().slice(0, 10);
  };
  const manualFines: Array<{
    structure: FeeStructure;
    amount?: number;
    note: string;
    incidentDate: string;
  }> = [
    {
      structure: uniformStructure,
      note: 'Uniform replacement — torn beyond repair',
      incidentDate: monthsAgo(3),
    },
    {
      structure: idCardStructure,
      note: 'Lost ID card, replacement issued',
      incidentDate: monthsAgo(2),
    },
    {
      structure: damageStructure,
      amount: 350,
      note: 'Broke a window pane in the science lab',
      incidentDate: today,
    },
  ];
  for (const fine of manualFines) {
    const existing = await studentFeeRepo.findOne({
      where: { student_id: studentOne.id, fee_structure_id: fine.structure.id, note: fine.note },
    });
    if (existing) continue;
    await finesService.logFine(
      {
        student_ids: [studentOne.id],
        fee_structure_id: fine.structure.id,
        amount: fine.amount,
        note: fine.note,
        incident_date: fine.incidentDate,
        notify_families: false,
      },
      school.id,
      adminUser.id,
      { headers: {} },
    );
    console.log(`Logged manual fine "${fine.note}" for ${studentOne.full_name}.`);
  }

  // --- 2. One month's attendance-fine sweep, seeding ABSENT marks first
  // if this tenant doesn't have any for that month yet. `generate()`
  // (not `runDue`) so this doesn't depend on what day `yarn seed` happens
  // to run on — `runDue`'s correction-window gate is scheduler-only
  // behaviour, already covered by `fine-sweep.service.integration.spec.ts`.
  const now = new Date(`${today}T00:00:00.000Z`);
  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousMonth = `${prevMonthDate.getUTCFullYear()}-${String(
    prevMonthDate.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
  const monthStart = `${previousMonth}-01`;
  const monthEndDate = new Date(
    Date.UTC(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1, 0),
  );
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  const existingAbsences = await attendanceRecordRepo.count({
    where: {
      tenant_id: school.id,
      student_id: In([studentOne.id, studentTwo.id]),
      status: AttendanceStatus.ABSENT,
      date: Between(monthStart, monthEnd),
    },
  });
  if (existingAbsences === 0) {
    const absentDates = ['02', '03', '04'].map((d) => `${previousMonth}-${d}`);
    for (const student of [studentOne, studentTwo]) {
      for (const date of absentDates) {
        let session = await attendanceSessionRepo.findOne({
          where: { tenant_id: school.id, section_id: student.class_section_id, date },
        });
        if (!session) {
          session = await attendanceSessionRepo.save(
            attendanceSessionRepo.create({
              tenant_id: school.id,
              section_id: student.class_section_id,
              date,
              period_no: null,
              state: AttendanceSessionState.FINALIZED,
            }),
          );
        }
        await attendanceRecordRepo.save(
          attendanceRecordRepo.create({
            tenant_id: school.id,
            session_id: session.id,
            student_id: student.id,
            date,
            status: AttendanceStatus.ABSENT,
          }),
        );
      }
    }
    console.log(`Seeded ABSENT marks for 2 students in ${previousMonth}.`);
  }

  const sweepResult = await fineSweepService.generate(
    school.id,
    adminUser.id,
    previousMonth,
    {},
    DuplicateStrategy.SKIP,
    false,
  );
  if (sweepResult.generated_count > 0) {
    console.log(`Fine sweep for ${previousMonth}: ${sweepResult.generated_count} bill(s) created.`);
  }

  // --- 3. Waive the oldest bill fully, pay the next one fully, then the
  // next one partially, leaving the last untouched — every `FeeStatus`
  // shows up. `PaymentAllocationService.recordWithAllocation` enforces
  // FIFO across a student's outstanding fees (oldest period first), so
  // this settles them oldest-first too, rather than by fee-structure name
  // — the August attendance-fine sweep bill is older than the three manual
  // fines above and would otherwise block payment against them.
  // Waiving bypasses the HTTP approval-token gate (`FinesService.waiveFine`
  // needs a real `X-Approval-Token`, a live OTP round trip this offline
  // script has no use for) and applies the same math `waiveFine` does
  // directly.
  const fineStructureIds = [
    damageStructure.id,
    idCardStructure.id,
    uniformStructure.id,
    absentStructure.id,
  ];
  const outstandingBills = await studentFeeRepo.find({
    // Scoped to the fine structures this function seeds — on a database
    // that already has other PENDING bills (tuition, etc.) for this
    // student, an unscoped query would waive/pay one of those instead.
    where: {
      student_id: studentOne.id,
      status: FeeStatus.PENDING,
      fee_structure_id: In(fineStructureIds),
    },
    order: { period_start: 'ASC', created_at: 'ASC' },
  });
  if (outstandingBills.length < 4) {
    console.warn(
      `Expected 4 outstanding fine bills for ${studentOne.full_name}, found ${outstandingBills.length} — skipping waive/payment step.`,
    );
    return;
  }
  const [oldest, second, third] = outstandingBills;
  // Every bill here is derived from the `today` anchor above (April 2026)
  // or earlier, so by the time this ever runs (today's real date is well
  // past that) they're always a past period — `DUE`, never `CURRENT`.
  // `PaymentAllocationService.classifyPeriod` compares against the real
  // server clock (local time), so computing this dynamically would just
  // reintroduce a UTC-vs-local-timezone race for no benefit.
  const allocationTypeFor = (): PaymentAllocationType => PaymentAllocationType.DUE;

  const oldestFullAmount = Number(oldest.total_amount);
  await studentFeeRepo.update(
    { id: oldest.id },
    {
      one_off_discount_amount: oldestFullAmount,
      discount_amount: oldestFullAmount,
      status: FeeStatus.WAIVED,
    },
  );
  console.log(`Waived fine bill ${oldest.id}.`);

  await paymentAllocationService.recordWithAllocation(
    {
      student_id: studentOne.id,
      total_amount: Number(second.total_amount),
      payment_method: PaymentMethod.CASH,
      allocations: [
        {
          student_fee_id: second.id,
          allocated_amount: Number(second.total_amount),
          allocation_type: allocationTypeFor(),
        },
      ],
    },
    school.id,
    adminUser.id,
  );
  console.log(`Fully paid fine bill ${second.id}.`);

  const partialAmount = Math.round((Number(third.total_amount) / 2) * 100) / 100;
  await paymentAllocationService.recordWithAllocation(
    {
      student_id: studentOne.id,
      total_amount: partialAmount,
      payment_method: PaymentMethod.CASH,
      allocations: [
        {
          student_fee_id: third.id,
          allocated_amount: partialAmount,
          allocation_type: allocationTypeFor(),
        },
      ],
    },
    school.id,
    adminUser.id,
  );
  console.log(`Recorded a partial payment of ৳${partialAmount} on fine bill ${third.id}.`);
}

// Only self-execute when run as a script (`yarn seed`). `seed.spec.ts`
// imports `seedAccounts` from this file, and an unguarded call here would
// try to boot the whole AppModule — and then `process.exit` — during the
// test run.
const isDirectRun =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isDirectRun) {
  seed()
    // createScriptAppContext boots the full AppModule (workers off, but its
    // queues and other modules still hold Redis connections that app.close()
    // doesn't reliably tear down), so the process can hang after seeding
    // finishes — force-exit once the promise settles instead of waiting on
    // the event loop.
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

/** [32.3.11] The print demo goes through the real services, so templates are made exactly as the API makes them. */
function printPorts(
  app: INestApplicationContext,
  schoolId: string,
  adminEmail: string,
  userRepository: Repository<User>,
): PrintDemoSeedPorts & PrintHistoryDemoSeedPorts {
  const templates = app.get(PrintTemplatesService);
  const storage = app.get(StorageService);
  const jobs = app.get(PrintJobsService);
  const history = app.get(PrintHistoryService);
  const adminId = async () => (await userRepository.findOneByOrFail({ email: adminEmail })).id;
  const caller = async () => ({ tenantId: schoolId, userId: await adminId(), role: 'ADMIN' });
  return {
    createTemplate: async (suggestionKey, name) =>
      templates.create(schoolId, await adminId(), { name, suggestion_key: suggestionKey }),
    publishTemplate: async (id) => templates.publish(schoolId, await adminId(), id),
    setDefaultTemplate: async (id) => templates.setDefault(schoolId, await adminId(), id),
    putObject: (key, body, type) => storage.put(key, body, type),
    createJob: async (input) => {
      const job = await jobs.create(await caller(), {
        template_id: input.templateId,
        subject_type: 'STUDENT',
        subject_ids: input.subjectIds,
        printer_profile_id: input.printerProfileId,
        batch_label: input.batchLabel,
      });
      return {
        job_id: job.job_id,
        items: (job.items as Array<{ item_id: string; subject_id: string }>).map((i) => ({
          item_id: i.item_id,
          subject_id: i.subject_id,
        })),
      };
    },
    confirmJob: async (jobId, failed) => jobs.confirm(await caller(), jobId, failed),
    reprintJob: async (jobId, itemIds) => {
      const again = await jobs.reprint(await caller(), jobId, itemIds);
      return { job_id: again.job_id };
    },
    revokeItem: async (itemId, reason) => history.revoke(await caller(), itemId, reason),
  };
}
