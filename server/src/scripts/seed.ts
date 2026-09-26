import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import * as bcrypt from 'bcrypt';
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
import { DEV_SEED_PLATFORM_TENANT_ID } from '../config/env.validation';
import { seedAccounts } from './seed.accounts';
import { Shift } from '../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../modules/routines/entities/period-slot.entity';
import { Room } from '../modules/routines/entities/room.entity';
import { Routine } from '../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../modules/routines/entities/routine-change-request.entity';
import { ensureDemoOrganisation } from './seed.util';

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

  const app = await NestFactory.createApplicationContext(AppModule);
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
    },
    school,
    adminEmail,
    passwordHash,
  );

  // [27.11] Sample admission intake + applicants, so local dev has
  // something to look at on the new People › Admissions screens without
  // manually submitting a public application first. Idempotent on
  // `title`, same "find-or-create" shape as the school block above.
  await ensureAdmissionSeed(dataSource, school);

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
  let intake = await intakeRepository.findOne({ where: { tenant_id: school.id, title } });
  if (!intake) {
    const section = await classSectionRepository.findOne({ where: { tenant_id: school.id } });
    if (!section) {
      console.warn('No class section found — skipping admission intake seed.');
      return;
    }
    intake = intakeRepository.create({
      tenant_id: school.id,
      class_section_id: section.id,
      title,
      seat_count: 30,
      open_date: '2026-01-01',
      close_date: '2026-12-31',
      required_document_types: ['PHOTO'],
    });
    await intakeRepository.save(intake);
    console.log(`Created admission intake "${title}" (${intake.id}).`);
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

// Only self-execute when run as a script (`yarn seed`). `seed.spec.ts`
// imports `seedAccounts` from this file, and an unguarded call here would
// try to boot the whole AppModule — and then `process.exit` — during the
// test run.
const isDirectRun =
  typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isDirectRun) {
  seed()
    // NestFactory.createApplicationContext boots the full AppModule, including
    // AuthModule/CommunicationsModule's BullMQ workers (@Processor). Those hold
    // open blocking Redis connections that app.close() doesn't reliably tear
    // down, so the process can hang indefinitely after seeding finishes —
    // force-exit once the promise settles instead of waiting on the event loop.
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
