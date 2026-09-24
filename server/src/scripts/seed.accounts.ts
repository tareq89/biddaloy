import { UserRole, UserStatus } from '@biddaloy/shared';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
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
import { Homework } from '../modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../modules/homework/entities/syllabus-topic.entity';
import {
  DEMO_ACADEMIC_YEAR,
  ensureAttendanceSeed,
  ensureCalendarDemoSeed,
  ensureDemoStudents,
  ensureGradingDemoSeed,
  ensureHomeworkDemoSeed,
  ensurePublicHolidaySet,
  ensureRoleTestUsers,
  ensureSecondSchoolMembership,
} from './seed.util';
import { BD_PUBLIC_HOLIDAYS_2026, BD_PUBLIC_HOLIDAYS_2027 } from './seed-data/public-holidays-bd';

/**
 * The account/membership/roster half of the seed, deliberately kept in its
 * own module so it can be imported WITHOUT pulling in `AppModule`.
 *
 * `seed.ts` boots Nest via `NestFactory.createApplicationContext(AppModule)`,
 * and `AppModule` calls `ConfigModule.forRoot()` at module-evaluation time,
 * which validates `DATABASE_URL` and `JWT_SECRET`. That happens on IMPORT, so
 * a `require.main === module` guard does not prevent it: merely importing
 * `seed.ts` from a spec was enough to throw an unhandled rejection in CI,
 * where those variables are not set for the unit-test job. It passed locally
 * only because a developer `.env` happens to supply them.
 *
 * Nothing here touches Nest, config or the DataSource — repositories are
 * passed in — so the seed's ordering invariant stays unit testable.
 */

/** Every repository `seedAccounts` writes through. Passed in rather than
 * pulled off the DataSource so the ordering invariant below is unit
 * testable without booting Nest. */
export interface SeedAccountRepositories {
  userRepository: Repository<User>;
  schoolRepository: Repository<School>;
  userTenantRepository: Repository<UserTenant>;
  academicYearRepository: Repository<AcademicYear>;
  classRepository: Repository<Class>;
  classSectionRepository: Repository<ClassSection>;
  studentRepository: Repository<Student>;
  guardianRepository: Repository<Guardian>;
  subjectRepository: Repository<Subject>;
  schoolHolidayRepository: Repository<CalendarEvent>;
  academicTermRepository: Repository<AcademicTerm>;
  calendarEventClassRepository: Repository<CalendarEventClass>;
  publicHolidaySetRepository: Repository<PublicHolidaySet>;
  publicHolidayEntryRepository: Repository<PublicHolidayEntry>;
  teacherRepository: Repository<Teacher>;
  teacherClassSectionRepository: Repository<TeacherClassSection>;
  attendanceSessionRepository: Repository<AttendanceSession>;
  attendanceRecordRepository: Repository<AttendanceRecord>;
  attendanceDeviceRepository: Repository<AttendanceDevice>;
  classSubjectRepository: Repository<ClassSubject>;
  gradingScaleRepository: Repository<GradingScale>;
  gradingBandRepository: Repository<GradingBand>;
  homeworkRepository: Repository<Homework>;
  homeworkAssignmentRepository: Repository<HomeworkAssignment>;
  homeworkSubmissionRepository: Repository<HomeworkSubmission>;
  syllabusTopicRepository: Repository<SyllabusTopic>;
}

/** Creates/repairs the seed accounts, their memberships and the demo
 * roster, at the default `school`. The *order* of the calls in here is
 * load-bearing — see the ORDER MATTERS comment inside. */
export async function seedAccounts(
  repos: SeedAccountRepositories,
  school: School,
  adminEmail: string,
  passwordHash: string,
): Promise<void> {
  // Check if the designated seed admin already exists (including soft-deleted)
  const existing = await repos.userRepository.findOne({
    where: { email: adminEmail },
    withDeleted: true,
  });

  let admin: User;
  if (existing) {
    if (existing.deleted_at) {
      existing.password_hash = passwordHash;
      existing.status = UserStatus.ACTIVE;
      existing.deleted_at = null;
      await repos.userRepository.save(existing);
      console.log('Restored soft-deleted SUPER_ADMIN account with fresh credentials.');
    } else {
      console.log('SUPER_ADMIN user already exists, skipping creation.');
    }
    admin = existing;
  } else {
    admin = repos.userRepository.create({
      email: adminEmail,
      phone: '01700000000',
      password_hash: passwordHash,
      status: UserStatus.ACTIVE,
      full_name: 'System Administrator',
    });
    await repos.userRepository.save(admin);
    console.log('SUPER_ADMIN user created:');
    console.log(`  Email: ${adminEmail}`);
  }

  // Create the SUPER_ADMIN's membership at the default school, if missing —
  // idempotent the same way the block above is, so a partially-seeded DB
  // (e.g. the admin row survived but its membership was manually deleted)
  // self-heals on the next run instead of erroring.
  const existingMembership = await repos.userTenantRepository.findOne({
    where: { user_id: admin.id, tenant_id: school.id },
  });
  if (!existingMembership) {
    const membership = repos.userTenantRepository.create({
      user_id: admin.id,
      tenant_id: school.id,
      role: UserRole.SUPER_ADMIN,
    });
    await repos.userTenantRepository.save(membership);
    console.log(`  Role: ${membership.role} at ${school.name}`);
  } else if (existingMembership.role !== UserRole.SUPER_ADMIN) {
    existingMembership.role = UserRole.SUPER_ADMIN;
    await repos.userTenantRepository.save(existingMembership);
    console.log(`  Role: reconciled to ${UserRole.SUPER_ADMIN} at ${school.name}`);
  }

  await ensureSecondSchoolMembership(repos.schoolRepository, repos.userTenantRepository, admin.id);

  // [8.9.6]: one account per remaining role, all at the default school —
  // see `seed.util.ts`'s own comment on why this is the manual-testing
  // path for role-gated nav specifically.
  //
  // ORDER MATTERS (#356), do not move this below the
  // `ensureSecondSchoolMembership` call that follows. Memberships are
  // resolved earliest-first (`AuthService.EARLIEST_MEMBERSHIP_ORDER`), so
  // whichever membership is inserted first becomes `memberships[0]` — the
  // tenant `scripts/lighthouse-student-url.mjs` queries for a student id.
  // Demo students are seeded at the default school only, so the default
  // school's membership has to be created before the second school's or
  // that script queries a deliberately empty tenant and the Lighthouse job
  // fails. `seed.spec.ts` pins this.
  await ensureRoleTestUsers(
    repos.userRepository,
    repos.userTenantRepository,
    school.id,
    passwordHash,
  );

  // [8.5.2]: the ADMIN seed account must be multi-membership so the E2E
  // tenant-picker specs have a real picker to land on — same second
  // school the super admin gets above. Deliberately *after*
  // `ensureRoleTestUsers` — see the ordering note above.
  const adminTestUser = await repos.userRepository.findOne({
    where: { email: 'admin@biddaloy.test' },
  });
  if (adminTestUser) {
    await ensureSecondSchoolMembership(
      repos.schoolRepository,
      repos.userTenantRepository,
      adminTestUser.id,
    );
  }

  // [8.13 / #356]: real Student rows at the default school. Without these
  // `scripts/lighthouse-student-url.mjs` has no student detail route to
  // resolve and the whole Lighthouse budget job crashes — see the comment
  // on `ensureDemoStudents`. Seeded only at the default school; the second
  // school stays deliberately empty so the tenant-picker specs still have
  // a visibly different tenant to switch into.
  const parentTestUser = await repos.userRepository.findOne({
    where: { email: 'parent@biddaloy.test' },
  });
  await ensureDemoStudents(
    {
      academicYearRepository: repos.academicYearRepository,
      classRepository: repos.classRepository,
      classSectionRepository: repos.classSectionRepository,
      studentRepository: repos.studentRepository,
      guardianRepository: repos.guardianRepository,
    },
    school.id,
    // [33.5.1] `school` is already in hand here — the caller (`seed.ts`)
    // must have run `ensureDemoOrganisation(school)` before this, or
    // `ensureDemoStudents` refuses any `DEMO_CLASSES` shift/version/group
    // the tenant's own vocabulary doesn't have (see its own comment).
    school.settings?.organisation,
    parentTestUser?.id ?? null,
  );

  // [17.2.6]: platform-wide BD public-holiday sets, published immediately —
  // no `tenant_id` involved (see `PublicHolidaySet`'s own D10 docstring), so
  // this only ever needs to run once regardless of how many schools exist.
  await ensurePublicHolidaySet(
    {
      publicHolidaySetRepository: repos.publicHolidaySetRepository,
      publicHolidayEntryRepository: repos.publicHolidayEntryRepository,
    },
    'BD',
    2026,
    BD_PUBLIC_HOLIDAYS_2026,
  );
  await ensurePublicHolidaySet(
    {
      publicHolidaySetRepository: repos.publicHolidaySetRepository,
      publicHolidayEntryRepository: repos.publicHolidayEntryRepository,
    },
    'BD',
    2027,
    BD_PUBLIC_HOLIDAYS_2027,
  );

  // [17.2.6]: three terms + one event of each remaining `CalendarEventType`
  // for the default school's `DEMO_ACADEMIC_YEAR`, scoping the EXAM event to
  // "Class 6" and "Class 7" — both created by `ensureDemoStudents` above.
  const calendarYear = await repos.academicYearRepository.findOne({
    where: { name: DEMO_ACADEMIC_YEAR.name, tenant_id: school.id },
  });
  const examClass6 = await repos.classRepository.findOne({
    where: { name: 'Class 6', tenant_id: school.id, academic_year_id: calendarYear?.id },
  });
  const examClass7 = await repos.classRepository.findOne({
    where: { name: 'Class 7', tenant_id: school.id, academic_year_id: calendarYear?.id },
  });
  if (calendarYear && examClass6 && examClass7) {
    await ensureCalendarDemoSeed(
      {
        academicTermRepository: repos.academicTermRepository,
        calendarEventRepository: repos.schoolHolidayRepository,
        calendarEventClassRepository: repos.calendarEventClassRepository,
      },
      {
        schoolId: school.id,
        academicYearId: calendarYear.id,
        examClassIds: [examClass6.id, examClass7.id],
      },
    );
  }

  // [20.4.1]: BD NCTB grading scale as the demo year's default, plus a
  // per-class override on "Class 6" (exercises the override path) and one
  // graded-only subject on that class, so Epic 19.0's screens have real
  // grading data to render against.
  if (calendarYear && examClass6) {
    await ensureGradingDemoSeed(
      {
        gradingScaleRepository: repos.gradingScaleRepository,
        gradingBandRepository: repos.gradingBandRepository,
        subjectRepository: repos.subjectRepository,
        classSubjectRepository: repos.classSubjectRepository,
      },
      school.id,
      calendarYear.id,
      examClass6.id,
    );
  }

  // [9.11]: deterministic attendance ground truth — subjects, holidays, a
  // teacher/section mapping, marks for every working day, and two devices — on top of
  // the just-seeded "Class 6" / section "A" roster. Deliberately after
  // `ensureDemoStudents`: the section and its exactly-3-student roster
  // must already exist to attach attendance to them.
  const teacherTestUser = await repos.userRepository.findOne({
    where: { email: 'teacher@biddaloy.test' },
  });
  if (teacherTestUser) {
    const academicYear = await repos.academicYearRepository.findOne({
      where: { name: DEMO_ACADEMIC_YEAR.name, tenant_id: school.id },
    });
    const attendanceClass = await repos.classRepository.findOne({
      where: { name: 'Class 6', tenant_id: school.id, academic_year_id: academicYear?.id },
    });
    const attendanceSection = attendanceClass
      ? await repos.classSectionRepository.findOne({
          where: { class_id: attendanceClass.id, section_name: 'A', tenant_id: school.id },
        })
      : null;
    const attendanceStudents = attendanceSection
      ? await repos.studentRepository.find({
          where: { class_section_id: attendanceSection.id, tenant_id: school.id },
          order: { roll_number: 'ASC' },
        })
      : [];

    if (academicYear && attendanceSection && attendanceStudents.length > 0) {
      await ensureAttendanceSeed(
        {
          subjectRepository: repos.subjectRepository,
          schoolHolidayRepository: repos.schoolHolidayRepository,
          teacherRepository: repos.teacherRepository,
          teacherClassSectionRepository: repos.teacherClassSectionRepository,
          attendanceSessionRepository: repos.attendanceSessionRepository,
          attendanceRecordRepository: repos.attendanceRecordRepository,
          attendanceDeviceRepository: repos.attendanceDeviceRepository,
        },
        {
          schoolId: school.id,
          academicYearId: academicYear.id,
          sectionId: attendanceSection.id,
          studentIds: attendanceStudents.map((s) => s.id),
          teacherUserId: teacherTestUser.id,
        },
      );
    }

    // [22.3.6]: one Homework, one section-wide assignment, three
    // submissions (one per seeded student, every completion status) and a
    // sample syllabus — reuses the exact "Class 6" / section "A" roster
    // `ensureAttendanceSeed` just attached to, and the MATH subject it just
    // seeded, so the demo data for Epic 22.0's workbook tabs/analytics has
    // real class/section/subject/student ids to hang off.
    const mathSubject = await repos.subjectRepository.findOne({
      where: { tenant_id: school.id, code: 'MATH' },
    });
    if (attendanceClass && attendanceSection && mathSubject && attendanceStudents.length > 0) {
      await ensureHomeworkDemoSeed(
        {
          homeworkRepository: repos.homeworkRepository,
          homeworkAssignmentRepository: repos.homeworkAssignmentRepository,
          homeworkSubmissionRepository: repos.homeworkSubmissionRepository,
          syllabusTopicRepository: repos.syllabusTopicRepository,
        },
        {
          schoolId: school.id,
          classId: attendanceClass.id,
          subjectId: mathSubject.id,
          sectionId: attendanceSection.id,
          studentIds: attendanceStudents.map((s) => s.id),
        },
      );
    }
  }
}
