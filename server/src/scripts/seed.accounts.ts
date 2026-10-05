import { AuthTokenPurpose, EnrollmentStatus, UserRole, UserStatus } from '@biddaloy/shared';
import * as bcrypt from 'bcrypt';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AuthToken } from '../modules/account-access/entities/auth-token.entity';
import { hashSecret } from '../modules/auth/token-hash.util';
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
import { Enrollment } from '../modules/students/entities/enrollment.entity';
import { PromotionRun } from '../modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../modules/promotions/entities/promotion-entry.entity';
import { SeatPlan } from '../modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from '../modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from '../modules/seat-plans/entities/seat-allocation.entity';
import { Program } from '../modules/programs/entities/program.entity';
import { ProgramMilestone } from '../modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../modules/programs/entities/milestone-achievement.entity';
import { FeeStructure } from '../modules/fees/entities/fee-structure.entity';
import { FineRule } from '../modules/fees/entities/fine-rule.entity';
import { RecurringSchedule } from '../modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../modules/fees/entities/recurring-schedule-structure.entity';
import { StaffHrRecord } from '../modules/staff-hr/entities/staff-hr-record.entity';
import { Designation } from '../modules/staff-hr/entities/designation.entity';
import { StaffDesignationHistory } from '../modules/staff-hr/entities/staff-designation-history.entity';
import { StaffFamilyMember } from '../modules/staff-hr/entities/staff-family-member.entity';
import { StaffAddress } from '../modules/staff-hr/entities/staff-address.entity';
import { StaffExperience } from '../modules/staff-hr/entities/staff-experience.entity';
import { StaffEducation } from '../modules/staff-hr/entities/staff-education.entity';
import { StaffTraining } from '../modules/staff-hr/entities/staff-training.entity';
import { StaffAchievement } from '../modules/staff-hr/entities/staff-achievement.entity';
import { StaffLanguage } from '../modules/staff-hr/entities/staff-language.entity';
import { PrinterProfile } from '../modules/print/entities/printer-profile.entity';
import { PrintTemplate } from '../modules/print/entities/print-template.entity';
import { PrintJob } from '../modules/print/entities/print-job.entity';
import { StaffProfile } from '../modules/staff-profiles/entities/staff-profile.entity';
import { StaffAttendanceSession } from '../modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeavePolicy } from '../modules/leave/entities/leave-policy.entity';
import { LeaveRecord } from '../modules/leave/entities/leave-record.entity';
import { localToday } from '../modules/attendance/attendance-policy.util';
import { resolveTenantSettings } from '../modules/schools/settings/tenant-settings-resolver';
import {
  DEMO_ACADEMIC_YEAR,
  ensureAttendanceOpsSeed,
  ensureAttendanceSeed,
  ensureCalendarDemoSeed,
  ensureDemoStudents,
  ensureExamsDemoSeed,
  ensureGradingDemoSeed,
  ensureHomeworkDemoSeed,
  ensureProgramsDemoSeed,
  ensureProgramParticipationDemoSeed,
  ensureFineSeedData,
  ensurePromotionDemoSeed,
  ensurePublicHolidaySet,
  ensureRoleTestUsers,
  ensureRoutineSeed,
  ensureSeatPlanDemoSeed,
  ensureStaffHrDemoSeed,
  ensurePrintDemoSeed,
  ensurePrintHistoryDemoSeed,
  type PrintDemoSeedPorts,
  type PrintHistoryDemoSeedPorts,
  ensurePrintProfileDemoSeed,
  ensureSecondSchoolMembership,
  ensureStaffHrSeed,
} from './seed.util';
import { Shift } from '../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../modules/routines/entities/period-slot.entity';
import { Room } from '../modules/routines/entities/room.entity';
import { Routine } from '../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../modules/routines/entities/routine-change-request.entity';
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
  shiftRepository: Repository<Shift>;
  periodSlotRepository: Repository<PeriodSlot>;
  roomRepository: Repository<Room>;
  routineRepository: Repository<Routine>;
  routineSlotRepository: Repository<RoutineSlot>;
  routineSlotTeacherRepository: Repository<RoutineSlotTeacher>;
  routineSubstitutionRepository: Repository<RoutineSubstitution>;
  routineChangeRequestRepository: Repository<RoutineChangeRequest>;
  examRepository: Repository<Exam>;
  examComponentRepository: Repository<ExamComponent>;
  markGridRepository: Repository<MarkGrid>;
  markRepository: Repository<Mark>;
  resultRepository: Repository<Result>;
  resultSubjectRepository: Repository<ResultSubject>;
  examScheduleRepository: Repository<ExamSchedule>;
  homeworkRepository: Repository<Homework>;
  homeworkAssignmentRepository: Repository<HomeworkAssignment>;
  homeworkSubmissionRepository: Repository<HomeworkSubmission>;
  syllabusTopicRepository: Repository<SyllabusTopic>;
  enrollmentRepository: Repository<Enrollment>;
  promotionRunRepository: Repository<PromotionRun>;
  promotionEntryRepository: Repository<PromotionEntry>;
  seatPlanRepository: Repository<SeatPlan>;
  seatPlanScheduleRepository: Repository<SeatPlanSchedule>;
  seatAllocationRepository: Repository<SeatAllocation>;
  programRepository: Repository<Program>;
  programMilestoneRepository: Repository<ProgramMilestone>;
  programEnrollmentRepository: Repository<ProgramEnrollment>;
  milestoneAchievementRepository: Repository<MilestoneAchievement>;
  feeStructureRepository: Repository<FeeStructure>;
  fineRuleRepository: Repository<FineRule>;
  recurringScheduleRepository: Repository<RecurringSchedule>;
  recurringScheduleStructureRepository: Repository<RecurringScheduleStructure>;
  staffProfileRepository: Repository<StaffProfile>;
  leavePolicyRepository: Repository<LeavePolicy>;
  staffAttendanceSessionRepository: Repository<StaffAttendanceSession>;
  staffAttendanceRecordRepository: Repository<StaffAttendanceRecord>;
  leaveRecordRepository: Repository<LeaveRecord>;
}

/** Creates/repairs the seed accounts, their memberships and the demo
 * roster, at the default `school`. The *order* of the calls in here is
 * load-bearing — see the ORDER MATTERS comment inside. */
export async function seedAccounts(
  repos: SeedAccountRepositories,
  school: School,
  adminEmail: string,
  passwordHash: string,
  /** Real app services for the print demo. Absent in unit tests, where the print demo is skipped. */
  printPorts?: PrintDemoSeedPorts & PrintHistoryDemoSeedPorts,
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

  // [36.4.5]: a `staff_profiles` row (plus the D9 leave-policy defaults, one
  // sample attendance day/mark, and one sample leave request) for the
  // just-created staff-role test users — ADMIN/ACCOUNTANT/EXECUTIVE/TEACHER
  // all get a staff HR record, matching who the migration backfills in a
  // real tenant. Deliberately after `ensureRoleTestUsers`, whose users this
  // reads by email.
  // Fixed email-to-employee-ID map, not `find()`'s row order: `find` with
  // no `ORDER BY` gives no ordering guarantee, so a partial reseed (one
  // user already profiled, another not) could assign an already-used
  // `EMP-SEED-00N` to the wrong user and hit the unique
  // `(tenant_id, employee_id)` constraint.
  const employeeIdByEmail = new Map<string, string>([
    ['admin@biddaloy.test', 'EMP-SEED-001'],
    ['accountant@biddaloy.test', 'EMP-SEED-002'],
    ['teacher@biddaloy.test', 'EMP-SEED-003'],
    ['executive@biddaloy.test', 'EMP-SEED-004'],
  ]);
  const staffRoleUsers = await repos.userRepository.find({
    where: [...employeeIdByEmail.keys()].map((email) => ({ email })),
  });
  // `find()` gives no row-order guarantee. `ensureStaffHrSeed` picks its
  // first entry as the sample attendance/leave record's owner, so a
  // different query-result order across runs would move that sample record
  // to a different profile. Order by the fixed email map instead.
  const staffRoleUserByEmail = new Map(staffRoleUsers.map((user) => [user.email, user]));
  const orderedStaffRoleUsers = [...employeeIdByEmail.entries()]
    .map(([email, employeeId]) => {
      const user = staffRoleUserByEmail.get(email);
      return user ? { userId: user.id, employeeId } : null;
    })
    .filter((x): x is { userId: string; employeeId: string } => x !== null);
  await ensureStaffHrSeed(
    {
      staffProfileRepository: repos.staffProfileRepository,
      leavePolicyRepository: repos.leavePolicyRepository,
      staffAttendanceSessionRepository: repos.staffAttendanceSessionRepository,
      staffAttendanceRecordRepository: repos.staffAttendanceRecordRepository,
      leaveRecordRepository: repos.leaveRecordRepository,
    },
    school.id,
    orderedStaffRoleUsers,
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

      // [21.11.1]: a published routine on top of the same "Class 6"
      // section A/B roster and `teacher@biddaloy.test` — deliberately
      // after `ensureAttendanceSeed`, whose Teacher row and "MATH"
      // subject this reuses.
      const primaryTeacher = await repos.teacherRepository.findOne({
        where: { user_id: teacherTestUser.id },
      });
      const attendanceClassForRoutine = await repos.classRepository.findOne({
        where: { name: 'Class 6', tenant_id: school.id, academic_year_id: academicYear.id },
      });
      const sectionB = attendanceClassForRoutine
        ? await repos.classSectionRepository.findOne({
            where: {
              class_id: attendanceClassForRoutine.id,
              section_name: 'B',
              tenant_id: school.id,
            },
          })
        : null;

      if (primaryTeacher && sectionB && attendanceClassForRoutine) {
        await ensureRoutineSeed(
          {
            userRepository: repos.userRepository,
            teacherRepository: repos.teacherRepository,
            teacherClassSectionRepository: repos.teacherClassSectionRepository,
            subjectRepository: repos.subjectRepository,
            classRepository: repos.classRepository,
            shiftRepository: repos.shiftRepository,
            periodSlotRepository: repos.periodSlotRepository,
            roomRepository: repos.roomRepository,
            routineRepository: repos.routineRepository,
            routineSlotRepository: repos.routineSlotRepository,
            routineSlotTeacherRepository: repos.routineSlotTeacherRepository,
            routineSubstitutionRepository: repos.routineSubstitutionRepository,
            routineChangeRequestRepository: repos.routineChangeRequestRepository,
          },
          {
            schoolId: school.id,
            academicYearId: academicYear.id,
            classId: attendanceClassForRoutine.id,
            sectionAId: attendanceSection.id,
            sectionBId: sectionB.id,
            primaryTeacherId: primaryTeacher.id,
            requestedByUserId: teacherTestUser.id,
          },
        );

        // [41.2.c]: the attendance-ops demo — recent registers for A and B,
        // today's pending states, a few period registers. After the
        // routine (its weekly slot drives the period registers) and the
        // MATH subject `ensureAttendanceSeed` created.
        const opsMath = await repos.subjectRepository.findOne({
          where: { tenant_id: school.id, code: 'MATH' },
        });
        const studentsB = await repos.studentRepository.find({
          where: { class_section_id: sectionB.id, tenant_id: school.id },
          order: { roll_number: 'ASC' },
        });
        if (opsMath && studentsB.length > 0) {
          await ensureAttendanceOpsSeed(
            {
              teacherRepository: repos.teacherRepository,
              teacherClassSectionRepository: repos.teacherClassSectionRepository,
              routineSlotRepository: repos.routineSlotRepository,
              periodSlotRepository: repos.periodSlotRepository,
              attendanceSessionRepository: repos.attendanceSessionRepository,
              attendanceRecordRepository: repos.attendanceRecordRepository,
            },
            {
              schoolId: school.id,
              today: localToday(
                resolveTenantSettings(school.settings ?? null).region?.timezone ?? 'Asia/Dhaka',
              ),
              sections: [
                { id: attendanceSection.id, studentIds: attendanceStudents.map((s) => s.id) },
                { id: sectionB.id, studentIds: studentsB.map((s) => s.id) },
              ],
              teacherUserId: teacherTestUser.id,
              subjectId: opsMath.id,
            },
          );
        }
      }
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

  // [34.1.4]: two tenant-wide programs ("Hifz" with 30 milestones, "Debate
  // club" with none) — placed right after the homework block above since
  // both are simple demo fixtures with no ordering dependency on it, just
  // grouped near it in the file.
  await ensureProgramsDemoSeed(
    {
      programRepository: repos.programRepository,
      programMilestoneRepository: repos.programMilestoneRepository,
    },
    { schoolId: school.id },
  );

  // [19.10.1]: demo exams/marks/results on top of "Class 6"'s two sections
  // — deliberately after both `ensureGradingDemoSeed` (the BD NCTB scale
  // this seed's one published result pins against) and `ensureAttendanceSeed`
  // (whose MATH/ENG subjects this reuses rather than creating duplicates).
  if (calendarYear && examClass6) {
    const scale = await repos.gradingScaleRepository.findOne({
      where: { tenant_id: school.id, academic_year_id: calendarYear.id, class_id: IsNull() },
    });
    const sectionA = await repos.classSectionRepository.findOne({
      where: { class_id: examClass6.id, section_name: 'A', tenant_id: school.id },
    });
    const sectionB = await repos.classSectionRepository.findOne({
      where: { class_id: examClass6.id, section_name: 'B', tenant_id: school.id },
    });
    const studentsA = sectionA
      ? await repos.studentRepository.find({
          where: { class_section_id: sectionA.id, tenant_id: school.id },
          order: { roll_number: 'ASC' },
        })
      : [];
    const studentsB = sectionB
      ? await repos.studentRepository.find({
          where: { class_section_id: sectionB.id, tenant_id: school.id },
          order: { roll_number: 'ASC' },
        })
      : [];

    if (scale && sectionA && sectionB && studentsA.length > 0 && studentsB.length > 0) {
      await ensureExamsDemoSeed(
        {
          subjectRepository: repos.subjectRepository,
          examRepository: repos.examRepository,
          examComponentRepository: repos.examComponentRepository,
          markGridRepository: repos.markGridRepository,
          markRepository: repos.markRepository,
          resultRepository: repos.resultRepository,
          resultSubjectRepository: repos.resultSubjectRepository,
          examScheduleRepository: repos.examScheduleRepository,
        },
        {
          schoolId: school.id,
          academicYearId: calendarYear.id,
          classId: examClass6.id,
          sectionIds: [sectionA.id, sectionB.id],
          sectionStudentIds: [studentsA.map((s) => s.id), studentsB.map((s) => s.id)],
          gradingScaleId: scale.id,
          gradingScaleRevision: scale.revision,
        },
      );

      // [34.2.4]: Hifz/Debate enrolments, Hifz achievements and a
      // program-targeted "Hifz monthly fee" schedule on the Class 6 A+B
      // roster — needs the roster above, so it can't live in
      // ensureProgramsDemoSeed. Built once and only run when the roster
      // has enough students for the seed's own split (2 programs, needs
      // ≥6 for a non-trivial roster per program).
      const programParticipationStudentIds = [...studentsA, ...studentsB].map((s) => s.id);
      if (programParticipationStudentIds.length >= 6) {
        await ensureProgramParticipationDemoSeed(
          {
            programRepository: repos.programRepository,
            programMilestoneRepository: repos.programMilestoneRepository,
            programEnrollmentRepository: repos.programEnrollmentRepository,
            milestoneAchievementRepository: repos.milestoneAchievementRepository,
            feeStructureRepository: repos.feeStructureRepository,
            recurringScheduleRepository: repos.recurringScheduleRepository,
            recurringScheduleStructureRepository: repos.recurringScheduleStructureRepository,
          },
          {
            schoolId: school.id,
            academicYearId: calendarYear.id,
            studentIds: programParticipationStudentIds,
            recordedByUserId: adminTestUser?.id ?? null,
          },
        );
      }

      // [38.1.4] Fine structures + rules — a school-default ATTENDANCE_ABSENT
      // rule and a class-specific ATTENDANCE_LATE rule for Class 6.
      await ensureFineSeedData(
        {
          feeStructureRepository: repos.feeStructureRepository,
          fineRuleRepository: repos.fineRuleRepository,
        },
        {
          schoolId: school.id,
          academicYearId: calendarYear.id,
          classId: examClass6.id,
        },
      );

      // [788] One COMMITTED promotion run for "Class 6", with one override
      // — deliberately after `ensureExamsDemoSeed` (whose exam this run's
      // `exam_ids` pins) and after `adminTestUser` is resolved above (the
      // run's `created_by`/`committed_by`/`approved_by`/override actor).
      if (adminTestUser) {
        await ensurePromotionDemoSeed(
          {
            academicYearRepository: repos.academicYearRepository,
            classRepository: repos.classRepository,
            classSectionRepository: repos.classSectionRepository,
            enrollmentRepository: repos.enrollmentRepository,
            promotionRunRepository: repos.promotionRunRepository,
            promotionEntryRepository: repos.promotionEntryRepository,
          },
          {
            schoolId: school.id,
            sourceClassId: examClass6.id,
            sourceAcademicYearId: calendarYear.id,
            examIds: [
              (
                await repos.examRepository.findOneOrFail({
                  where: {
                    tenant_id: school.id,
                    academic_year_id: calendarYear.id,
                    class_id: examClass6.id,
                  },
                })
              ).id,
            ],
            createdByUserId: adminTestUser.id,
            sectionStudentIds: [studentsA.map((s) => s.id), studentsB.map((s) => s.id)],
          },
        );
      }

      // [25.8]: seat plans reuse the "First Term Exam" MATH/ENG schedules
      // `ensureExamsDemoSeed` just created above.
      const mathSubject = await repos.subjectRepository.findOne({
        where: { tenant_id: school.id, code: 'MATH' },
      });
      const englishSubject = await repos.subjectRepository.findOne({
        where: { tenant_id: school.id, code: 'ENG' },
      });
      const firstTermExam = await repos.examRepository.findOne({
        where: {
          tenant_id: school.id,
          academic_year_id: calendarYear.id,
          class_id: examClass6.id,
          name: 'First Term Exam',
        },
      });
      const mathSchedule =
        firstTermExam && mathSubject
          ? await repos.examScheduleRepository.findOne({
              where: { exam_id: firstTermExam.id, subject_id: mathSubject.id },
            })
          : null;
      const englishSchedule =
        firstTermExam && englishSubject
          ? await repos.examScheduleRepository.findOne({
              where: { exam_id: firstTermExam.id, subject_id: englishSubject.id },
            })
          : null;
      if (mathSubject && mathSchedule && englishSchedule) {
        await ensureSeatPlanDemoSeed(
          {
            roomRepository: repos.roomRepository,
            examRepository: repos.examRepository,
            examScheduleRepository: repos.examScheduleRepository,
            seatPlanRepository: repos.seatPlanRepository,
            seatPlanScheduleRepository: repos.seatPlanScheduleRepository,
            seatAllocationRepository: repos.seatAllocationRepository,
          },
          {
            schoolId: school.id,
            academicYearId: calendarYear.id,
            classId: examClass6.id,
            mathSubjectId: mathSubject.id,
            mathScheduleId: mathSchedule.id,
            englishScheduleId: englishSchedule.id,
            studentIds: [...studentsA.map((s) => s.id), ...studentsB.map((s) => s.id)],
          },
        );
      }
    }
  }

  // Staff HR demo records + Bangla names/blood groups for the ID-card demos. The HR repositories
  // come off the manager (absent in the unit-test FakeRepo), so this whole block is skipped there.
  const manager = repos.studentRepository.manager;
  if (manager) {
    await ensureStaffHrDemoSeed(
      {
        userRepository: repos.userRepository,
        userTenantRepository: repos.userTenantRepository,
        designationRepository: manager.getRepository(Designation),
        staffHrRecordRepository: manager.getRepository(StaffHrRecord),
        staffDesignationHistoryRepository: manager.getRepository(StaffDesignationHistory),
        staffFamilyMemberRepository: manager.getRepository(StaffFamilyMember),
        staffAddressRepository: manager.getRepository(StaffAddress),
        staffExperienceRepository: manager.getRepository(StaffExperience),
        staffEducationRepository: manager.getRepository(StaffEducation),
        staffTrainingRepository: manager.getRepository(StaffTraining),
        staffAchievementRepository: manager.getRepository(StaffAchievement),
        staffLanguageRepository: manager.getRepository(StaffLanguage),
      },
      { schoolId: school.id },
    );
  }
  await ensurePrintProfileDemoSeed(
    {
      studentRepository: repos.studentRepository,
      staffHrRecordRepository: manager?.getRepository(StaffHrRecord),
    },
    { schoolId: school.id },
  );

  // [32.3.11] Printers, published ID-card templates and student photos.
  if (manager && printPorts) {
    await ensurePrintDemoSeed(
      {
        printerRepository: manager.getRepository(PrinterProfile),
        printTemplateRepository: manager.getRepository(PrintTemplate),
        studentRepository: repos.studentRepository,
      },
      printPorts,
      { schoolId: school.id },
    );
    // [32.4.4] A populated history: confirmed, failed + reprinted, and revoked.
    await ensurePrintHistoryDemoSeed(
      {
        printJobRepository: manager.getRepository(PrintJob),
        printTemplateRepository: manager.getRepository(PrintTemplate),
        printerRepository: manager.getRepository(PrinterProfile),
        studentRepository: repos.studentRepository,
      },
      printPorts,
      { schoolId: school.id },
    );
  }
}

/** [13.1.4] Fixed so e2e can open the teacher's invite link; mirrored in `e2e/seed-contract.ts`. */
export const TRIAL_DEMO = {
  slug: 'trial-demo-school',
  name: 'Trial Demo School',
  adminEmail: 'trial-admin@biddaloy.test',
  teacherEmail: 'trial-teacher@biddaloy.test',
  inviteToken: 'seed-trial-teacher-invite-token-0000000000',
  trialDays: 23,
  seatLimit: 10,
  studentCount: 4,
} as const;

/** [13.1.4] One school mid-trial ("4 of 10" students, 23 days left) that has not
 * finished onboarding, its ADMIN, and a TEACHER invited but not yet activated
 * (`password_hash = null` + a live INVITE token). Idempotent on slug / email /
 * registration number; existing schools are untouched. */
export async function ensureTrialDemoSeed(
  manager: EntityManager,
  passwordHash: string,
): Promise<School> {
  const schools = manager.getRepository(School);
  let school = await schools.findOne({ where: { slug: TRIAL_DEMO.slug } });
  if (!school) {
    school = await schools.save(
      schools.create({
        name: TRIAL_DEMO.name,
        slug: TRIAL_DEMO.slug,
        country_code: 'BD',
        trial_ends_at: new Date(Date.now() + TRIAL_DEMO.trialDays * 86_400_000),
        seat_limit: TRIAL_DEMO.seatLimit,
        onboarding: null,
      }),
    );
    console.log(`  School: ${school.name} (${school.id}) — trial`);
  }
  const tenant_id = school.id;

  const users = manager.getRepository(User);
  const memberships = manager.getRepository(UserTenant);
  const ensureUser = async (
    email: string,
    role: UserRole,
    fullName: string,
    hash: string | null,
  ) => {
    let user = await users.findOne({ where: { email } });
    if (!user) {
      user = await users.save(
        users.create({
          email,
          password_hash: hash,
          status: UserStatus.ACTIVE,
          full_name: fullName,
        }),
      );
    }
    const where = { user_id: user.id, tenant_id };
    if (!(await memberships.findOne({ where }))) {
      await memberships.save(memberships.create({ ...where, role }));
    }
    return user;
  };
  const admin = await ensureUser(
    TRIAL_DEMO.adminEmail,
    UserRole.ADMIN,
    'Trial School Admin',
    passwordHash,
  );
  const teacher = await ensureUser(
    TRIAL_DEMO.teacherEmail,
    UserRole.TEACHER,
    'Invited Teacher',
    null,
  );

  const tokens = manager.getRepository(AuthToken);
  const token_hash = hashSecret(TRIAL_DEMO.inviteToken);
  if (!(await tokens.findOne({ where: { token_hash } }))) {
    await tokens.save(
      tokens.create({
        user_id: teacher.id,
        tenant_id,
        purpose: AuthTokenPurpose.INVITE,
        token_hash,
        expires_at: new Date(Date.now() + 365 * 86_400_000),
        created_by_user_id: admin.id,
      }),
    );
  }

  // One academic year, two classes (one section each), four ACTIVE students.
  const years = manager.getRepository(AcademicYear);
  let year = await years.findOne({ where: { tenant_id, name: DEMO_ACADEMIC_YEAR.name } });
  year ??= await years.save(
    years.create({
      tenant_id,
      name: DEMO_ACADEMIC_YEAR.name,
      start_date: new Date(DEMO_ACADEMIC_YEAR.start_date),
      end_date: new Date(DEMO_ACADEMIC_YEAR.end_date),
      is_current: true,
    }),
  );
  const classes = manager.getRepository(Class);
  const sections = manager.getRepository(ClassSection);
  const studentsRepo = manager.getRepository(Student);
  const sectionIds: string[] = [];
  for (const [i, name] of ['Class 1', 'Class 2'].entries()) {
    let cls = await classes.findOne({ where: { tenant_id, academic_year_id: year.id, name } });
    cls ??= await classes.save(
      classes.create({ tenant_id, academic_year_id: year.id, name, numeric_grade: i + 1 }),
    );
    let section = await sections.findOne({
      where: { tenant_id, class_id: cls.id, section_name: 'A' },
    });
    section ??= await sections.save(
      sections.create({ tenant_id, class_id: cls.id, section_name: 'A' }),
    );
    sectionIds.push(section.id);
  }
  for (let n = 1; n <= TRIAL_DEMO.studentCount; n++) {
    const registration_number = `TRIAL-${String(n).padStart(4, '0')}`;
    if (await studentsRepo.findOne({ where: { tenant_id, registration_number } })) continue;
    await studentsRepo.save(
      studentsRepo.create({
        tenant_id,
        registration_number,
        full_name: `Trial Student ${n}`,
        class_section_id: sectionIds[n % 2]!,
        roll_number: Math.ceil(n / 2),
        enrollment_status: EnrollmentStatus.ACTIVE,
      }),
    );
  }
  return school;
}
