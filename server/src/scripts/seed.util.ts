import {
  AttendanceDeviceKind,
  AttendanceDeviceStatus,
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  CalendarAudience,
  CalendarEventType,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkGridState,
  MarkStatus,
  PublicHolidaySource,
  TeacherDesignation,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import type { OrganisationSettings } from '@biddaloy/shared';
import { FindOptionsWhere, IsNull, ObjectLiteral, Repository } from 'typeorm';
import { School } from '../modules/schools/entities/school.entity';
import { User } from '../modules/users/entities/user.entity';
import { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import { Class } from '../modules/academics/entities/class.entity';
import { ClassSection } from '../modules/academics/entities/class-section.entity';
import { Student } from '../modules/students/entities/student.entity';
import { Guardian } from '../modules/students/entities/guardian.entity';
import { Subject } from '../modules/academics/entities/subject.entity';
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
import { hashDeviceKey } from '../modules/attendance/devices/device.service';
import { SeedPublicHolidayEntry } from './seed-data/public-holidays-bd';
import { Shift } from '../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../modules/routines/entities/period-slot.entity';
import { Room } from '../modules/routines/entities/room.entity';
import { Routine } from '../modules/routines/entities/routine.entity';
import { RoutineSlot } from '../modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../modules/routines/entities/routine-change-request.entity';
import {
  PeriodSlotKind,
  SlotRecurrence,
  RoutineState,
  ChangeRequestState,
  HomeworkGradingMode,
  HomeworkAssignmentStatus,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
} from '@biddaloy/shared';
import { Homework } from '../modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../modules/homework/entities/syllabus-topic.entity';

/** [8.9.5] manual-testing aid: gives the seed admin a *second* school
 * membership so `/select-school`'s picker actually has something to show
 * — a single-membership account always skips it. Idempotent (safe to
 * call on every seed run, new account or existing one): finds-or-creates
 * both the school and the membership row rather than assuming either is
 * missing.
 *
 * Kept out of `seed.ts` (which runs `seed()` as an unconditional top-level
 * side effect against a real `NestFactory`-booted app) so it can be
 * unit-tested directly against mocked repositories in `seed.util.spec.ts`
 * — same split as `reencrypt-settings.ts`/`reencrypt-settings.util.ts`. */
export async function ensureSecondSchoolMembership(
  schoolRepository: Repository<School>,
  userTenantRepository: Repository<UserTenant>,
  adminId: string,
): Promise<void> {
  let secondSchool = await schoolRepository.findOne({ where: { slug: 'rose-valley-school' } });
  if (!secondSchool) {
    secondSchool = schoolRepository.create({
      name: 'Rose Valley School',
      slug: 'rose-valley-school',
    });
    await schoolRepository.save(secondSchool);
    console.log(`  School: ${secondSchool.name} (${secondSchool.id})`);
  }

  const existingMembership = await userTenantRepository.findOne({
    where: { user_id: adminId, tenant_id: secondSchool.id },
  });
  if (!existingMembership) {
    const membership = userTenantRepository.create({
      user_id: adminId,
      tenant_id: secondSchool.id,
      role: UserRole.ADMIN,
    });
    await userTenantRepository.save(membership);
    console.log(`  Role: ${membership.role} at ${secondSchool.name}`);
  }
}

export interface RoleTestUserSeed {
  email: string;
  role: UserRole;
  fullName: string;
}

/** One test account per role, for manual role-based UI checks and the
 * E2E auth fixtures. */
export const ROLE_TEST_USERS: readonly RoleTestUserSeed[] = [
  { email: 'superadmin@biddaloy.test', role: UserRole.SUPER_ADMIN, fullName: 'Super Admin User' },
  { email: 'admin@biddaloy.test', role: UserRole.ADMIN, fullName: 'Admin User' },
  { email: 'accountant@biddaloy.test', role: UserRole.ACCOUNTANT, fullName: 'Accountant User' },
  { email: 'teacher@biddaloy.test', role: UserRole.TEACHER, fullName: 'Teacher User' },
  { email: 'parent@biddaloy.test', role: UserRole.PARENT, fullName: 'Parent User' },
  { email: 'student@biddaloy.test', role: UserRole.STUDENT, fullName: 'Student User' },
  { email: 'executive@biddaloy.test', role: UserRole.EXECUTIVE, fullName: 'Executive User' },
];

/** Idempotent, same shape as `ensureSecondSchoolMembership`: find-or-
 * create (restoring a soft-deleted account with a fresh password rather
 * than erroring) then find-or-create the membership. All six share
 * `passwordHash` — one already-required `SEED_ADMIN_PASSWORD` env var,
 * not six new ones, for local/dev seed accounts that exist to be logged
 * into by hand. */
export async function ensureRoleTestUsers(
  userRepository: Repository<User>,
  userTenantRepository: Repository<UserTenant>,
  schoolId: string,
  passwordHash: string,
): Promise<void> {
  for (const { email, role, fullName } of ROLE_TEST_USERS) {
    let user = await userRepository.findOne({ where: { email }, withDeleted: true });

    if (!user) {
      user = userRepository.create({
        email,
        password_hash: passwordHash,
        status: UserStatus.ACTIVE,
        full_name: fullName,
      });
      await userRepository.save(user);
      console.log(`  ${role} test user created: ${email}`);
    } else if (user.deleted_at) {
      user.password_hash = passwordHash;
      user.status = UserStatus.ACTIVE;
      user.deleted_at = null;
      await userRepository.save(user);
      console.log(`  ${role} test user restored: ${email}`);
    }

    const existingMembership = await userTenantRepository.findOne({
      where: { user_id: user.id, tenant_id: schoolId },
    });
    if (!existingMembership) {
      const membership = userTenantRepository.create({
        user_id: user.id,
        tenant_id: schoolId,
        role,
      });
      await userTenantRepository.save(membership);
      console.log(`  Role: ${role} at school ${schoolId}`);
    } else if (existingMembership.role !== role) {
      existingMembership.role = role;
      await userTenantRepository.save(existingMembership);
      console.log(`  Role: reconciled to ${role} at school ${schoolId}`);
    }
  }
}

/** The academic chain + student roster the demo/CI database needs.
 *
 * Why this exists (#356): the Lighthouse job profiles the *student detail*
 * route, and `scripts/lighthouse-student-url.mjs` resolves that route by
 * asking the API for the first student in the seeded tenant. Before this,
 * the seed created a `student@biddaloy.test` login but zero `Student`
 * rows, so the resolver exited 1 and the whole perf gate crashed. The
 * roster below is deliberately small-but-real — several classes, two
 * sections each, a handful of students per section — so both the list
 * route (pagination, class column, search) and the detail route
 * (guardian card, class/section, enrollment) render something meaningful
 * instead of one degenerate row.
 *
 * `Student.class_section_id` is non-nullable, so the whole academic chain
 * (academic year → class → section) has to exist first; it is created here
 * rather than assumed. */
export const DEMO_ACADEMIC_YEAR = {
  name: '2026-2027',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
} as const;

/** [33.5.1] The tenant's `settings.organisation` vocabulary for demo/seed
 * data. `DEMO_CLASSES` below draws every shift/version/group value from
 * exactly this list — `ClassService.create`/`SectionService.create` reject
 * any value not in the tenant's own vocabulary (`assertInVocabulary`), and
 * this seed script writes rows straight through the repository, bypassing
 * that check. Keeping the two in sync by hand (rather than by the type
 * system) is why `seed.util.spec.ts` asserts every `DEMO_CLASSES` value is
 * a member of this list. */
export const DEMO_ORGANISATION: OrganisationSettings = {
  shifts: ['Morning', 'Day'],
  versions: ['Bangla', 'English'],
  groups: ['Science', 'Commerce', 'Arts'],
};

/** Writes `DEMO_ORGANISATION` onto `school.settings.organisation` — but
 * only when the tenant doesn't already have one, so a developer's
 * hand-edited vocabulary (via the organisation settings UI) survives a
 * re-run of `yarn seed`. Returns whether it changed anything, so callers
 * only `save()` when needed. */
export function ensureDemoOrganisation(school: School): boolean {
  if (school.settings?.organisation) return false;
  school.settings = { ...(school.settings ?? {}), organisation: DEMO_ORGANISATION };
  return true;
}

/** [33.5.1] Throws if `value` (a `DEMO_CLASSES` shift/version/group) isn't
 * in the tenant's own vocabulary — see `ensureDemoStudents`'s own comment
 * on why this check exists instead of just writing the value anyway. */
function assertVocabularyHas(
  kind: 'shift' | 'version' | 'group',
  value: string,
  className: string,
  vocabulary: readonly string[],
): void {
  if (vocabulary.includes(value)) return;
  throw new Error(
    `Seed refuses to write class "${className}" with ${kind} "${value}": tenant vocabulary ` +
      `${kind}s is [${vocabulary.join(', ')}] — add it in Settings → Organisation, or clear ` +
      `settings.organisation so ensureDemoOrganisation can default it.`,
  );
}

export interface DemoSectionSeed {
  name: string;
  /** [33.5.1] Validated against `DEMO_ORGANISATION.groups`; `null` = no group. */
  group: string | null;
}

export interface DemoClassSeed {
  name: string;
  numericGrade: number;
  /** [33.5.1] Validated against `DEMO_ORGANISATION.shifts`/`.versions`; `null` = tenant doesn't use that dimension. */
  shift: string | null;
  version: string | null;
  sections: readonly DemoSectionSeed[];
}

// [33.5.1] "Class 8" is deliberately seeded twice with the same name and
// academic year, differing only by shift — two real classes sharing a name
// is exactly the case `classesTab.naturalKey` (and the DB's own
// `NULLS NOT DISTINCT` unique index) has to tell apart, so the demo data
// and the round-trip fixture exercise it instead of only unit tests doing
// so. "Class 6" is left with shift/version/group all `null`, covering the
// "tenant doesn't use this dimension" case the same way.
export const DEMO_CLASSES: readonly DemoClassSeed[] = [
  {
    name: 'Class 6',
    numericGrade: 6,
    shift: null,
    version: null,
    sections: [
      { name: 'A', group: null },
      { name: 'B', group: null },
    ],
  },
  {
    name: 'Class 7',
    numericGrade: 7,
    shift: 'Morning',
    version: 'Bangla',
    sections: [
      { name: 'A', group: 'Science' },
      { name: 'B', group: 'Commerce' },
    ],
  },
  {
    name: 'Class 8',
    numericGrade: 8,
    shift: 'Morning',
    version: 'English',
    sections: [{ name: 'A', group: 'Arts' }],
  },
  {
    name: 'Class 8',
    numericGrade: 8,
    shift: 'Day',
    version: null,
    sections: [{ name: 'A', group: null }],
  },
];

/** Three per section, in section order — enough for the list route to show
 * a populated table and for roll numbers to be a real 1..N sequence. */
export const DEMO_STUDENTS_PER_SECTION = 3;

/** Names are cycled over the roster so every seeded student is a plausible
 * person rather than "Student 7". Length is coprime-ish with the roster
 * size on purpose so the same name does not land in the same slot twice. */
const DEMO_STUDENT_NAMES: readonly string[] = [
  'Nusrat Jahan',
  'Tanvir Ahmed',
  'Sadia Islam',
  'Rakibul Hasan',
  'Farhana Akter',
  'Imran Kabir',
  'Mahmuda Khatun',
  'Shakib Rahman',
  'Priya Chowdhury',
  'Arif Hossain',
  'Sumaiya Binte Alam',
  'Jubayer Siddique',
  'Rima Das',
  'Naimul Islam',
  'Tasnim Rahman',
];

const DEMO_GUARDIAN_NAMES: readonly string[] = [
  'Abdul Karim',
  'Rehana Begum',
  'Mizanur Rahman',
  'Shahnaz Parvin',
  'Golam Mostafa',
];

export interface DemoStudentRepositories {
  academicYearRepository: Repository<AcademicYear>;
  classRepository: Repository<Class>;
  classSectionRepository: Repository<ClassSection>;
  studentRepository: Repository<Student>;
  guardianRepository: Repository<Guardian>;
}

export interface DemoStudentSeedResult {
  classes: number;
  sections: number;
  students: number;
  guardians: number;
}

/** Restores a soft-deleted seed row instead of leaving it deleted.
 *
 * Two different index shapes are in play here, and they need different
 * lookups before this is safe to call:
 *
 * - **Plain unique index** (no `WHERE deleted_at IS NULL`) —
 *   `students(tenant_id, registration_number)`,
 *   `students(class_section_id, roll_number)`,
 *   `classes(name, academic_year_id, tenant_id)`. A soft-deleted row still
 *   occupies the key, so at most one row can ever match and a blind insert
 *   on the next run would fail. `findOne({ withDeleted: true })` is correct.
 * - **Partial unique index** (`WHERE "deleted_at" IS NULL`) —
 *   `academic_years(name, tenant_id)`,
 *   `class_sections(class_id, section_name)`. Soft-deleted rows are outside
 *   the index, so a deleted `2026-2027` can legitimately coexist with a live
 *   one. Those call sites must go through `findLivePreferred` below, or they
 *   risk undeleting the dead row into a collision with the live one.
 *
 * A row can also sit under *more than one* index. `academic_years` carries a
 * second partial unique index,
 * `academic_years(is_current, tenant_id) WHERE is_current = true AND
 * deleted_at IS NULL`, so restoring a dead year that was `is_current` puts it
 * back into that index too — and collides if the tenant has crowned another
 * year meanwhile. Callers must re-check `is_current` before restoring, exactly
 * as the create path does.
 *
 * `guardians` has no unique index at all; restoring there is idempotence,
 * not constraint avoidance. */
function undelete<T extends { deleted_at: Date | null }>(row: T): T {
  row.deleted_at = null;
  return row;
}

/** Find-or-create lookup for the *partial*-unique-index entities described
 * above: return the live row if there is one, and only fall back to a
 * soft-deleted row when nothing live owns the key (in which case restoring
 * it cannot collide). */
async function findLivePreferred<T extends ObjectLiteral>(
  repository: Repository<T>,
  where: FindOptionsWhere<T>,
): Promise<T | null> {
  const live = await repository.findOne({ where });
  if (live) return live;
  return repository.findOne({ where, withDeleted: true });
}

/** `students(class_section_id, roll_number)` is a *plain* unique index, so a
 * soft-deleted row still owns its slot, and a dev database that hand-made a
 * `Class 6` / section `A` under `2026-2027` already owns rolls 1..3 — the
 * roster's preferred numbers. The registration-number check upstream cannot
 * see those rows (they carry different registration numbers), so the roll has
 * to be resolved against the section itself: walk forward from the preferred
 * number to the first free slot.
 *
 * Bounded rather than unbounded: a section this crowded means something other
 * than "seed re-run" is going on, and a loud failure beats an endless probe. */
const MAX_ROLL_PROBE = 500;

async function findFreeRollNumber(
  studentRepository: Repository<Student>,
  classSectionId: string,
  preferred: number,
): Promise<number> {
  for (let roll = preferred; roll < preferred + MAX_ROLL_PROBE; roll += 1) {
    const taken = await studentRepository.findOne({
      where: { class_section_id: classSectionId, roll_number: roll },
      withDeleted: true,
    });
    if (!taken) return roll;
  }
  throw new Error(
    `Could not find a free roll number in section ${classSectionId} after ` +
      `${MAX_ROLL_PROBE} attempts starting at ${preferred}.`,
  );
}

/** Idempotent, in exactly the same find-or-create shape as
 * `ensureRoleTestUsers` above: safe to re-run against a database that is
 * already fully seeded, partially seeded, or has had rows soft-deleted by
 * hand. Everything created here is scoped to `schoolId` — no row is
 * written without an explicit `tenant_id`. */
export async function ensureDemoStudents(
  repos: DemoStudentRepositories,
  schoolId: string,
  // [33.5.1] The tenant's own `settings.organisation` — the caller already
  // holds the `School` entity this belongs to (`seedAccounts` receives it
  // as a parameter; nothing here refetches it by id), so this is threaded
  // straight through rather than looked up again from a `schoolRepository`
  // this function would otherwise need to carry just for this one read.
  organisation: OrganisationSettings | undefined,
  guardianUserId: string | null = null,
): Promise<DemoStudentSeedResult> {
  const {
    academicYearRepository,
    classRepository,
    classSectionRepository,
    studentRepository,
    guardianRepository,
  } = repos;

  // --- academic year -------------------------------------------------
  let year = await findLivePreferred(academicYearRepository, {
    name: DEMO_ACADEMIC_YEAR.name,
    tenant_id: schoolId,
  });
  if (!year) {
    // Only claim `is_current` if the tenant has no current year: the
    // partial unique index allows exactly one, and a dev database may
    // already have picked one by hand.
    const existingCurrent = await academicYearRepository.findOne({
      where: { tenant_id: schoolId, is_current: true },
    });
    year = academicYearRepository.create({
      name: DEMO_ACADEMIC_YEAR.name,
      start_date: new Date(DEMO_ACADEMIC_YEAR.start_date),
      end_date: new Date(DEMO_ACADEMIC_YEAR.end_date),
      is_current: !existingCurrent,
      tenant_id: schoolId,
    });
    await academicYearRepository.save(year);
    console.log(`  Academic year: ${year.name} (${year.id})`);
  } else if (year.deleted_at) {
    // Restoring re-enters the `is_current` partial unique index as well as
    // the `(name, tenant_id)` one: while this year was deleted, a dev may
    // have marked another year current by hand. Ask the same question the
    // create path asks, or the restore aborts the whole seed.
    if (year.is_current) {
      const existingCurrent = await academicYearRepository.findOne({
        where: { tenant_id: schoolId, is_current: true },
      });
      if (existingCurrent) year.is_current = false;
    }
    await academicYearRepository.save(undelete(year));
  }

  const result: DemoStudentSeedResult = { classes: 0, sections: 0, students: 0, guardians: 0 };

  // --- guardians -----------------------------------------------------
  // One guardian per name, reused across siblings. The first is linked to
  // the `parent@biddaloy.test` account when one is supplied, so `/portal`
  // (measured as that user by scripts/lighthouse-auth.cjs) has real
  // children to render instead of an empty state.
  const guardians: Guardian[] = [];
  for (const [index, fullName] of DEMO_GUARDIAN_NAMES.entries()) {
    const email = `guardian${index + 1}@biddaloy.test`;
    let guardian = await guardianRepository.findOne({
      where: { email, tenant_id: schoolId },
      withDeleted: true,
    });
    if (!guardian) {
      guardian = guardianRepository.create({
        full_name: fullName,
        relationship: index % 2 === 0 ? 'Father' : 'Mother',
        phone: `01710${String(100000 + index).slice(-6)}`,
        email,
        is_primary_contact: true,
        tenant_id: schoolId,
        user_id: index === 0 ? guardianUserId : null,
      });
      await guardianRepository.save(guardian);
      result.guardians += 1;
    } else {
      let dirty = false;
      if (guardian.deleted_at) {
        undelete(guardian);
        dirty = true;
      }
      // Re-link on re-run: an older seed may have created this guardian
      // before the portal account existed.
      if (index === 0 && guardianUserId && guardian.user_id !== guardianUserId) {
        guardian.user_id = guardianUserId;
        dirty = true;
      }
      if (dirty) await guardianRepository.save(guardian);
    }
    guardians.push(guardian);
  }

  // --- classes, sections, students ------------------------------------
  // [33.5.1] This loop writes `shift`/`version`/`group_name` straight
  // through the repository, bypassing `ClassService`/`SectionService`'s
  // own `assertInVocabulary` — so this is the only thing standing between
  // `DEMO_CLASSES` and writing a class/section that names a value the
  // tenant's own vocabulary doesn't have. That's the orphaned state
  // [33.5.1]'s seed trap 2 exists to rule out: refusing loudly here beats
  // writing it anyway and finding out later. Doesn't widen
  // `ensureDemoOrganisation`'s own guard to overwrite a hand-edited
  // vocabulary — that guard is correct as-is; this just holds the
  // invariant at the point it would otherwise be violated.
  const tenantShifts = organisation?.shifts ?? [];
  const tenantVersions = organisation?.versions ?? [];
  const tenantGroups = organisation?.groups ?? [];
  for (const classSeed of DEMO_CLASSES) {
    if (classSeed.shift !== null) {
      assertVocabularyHas('shift', classSeed.shift, classSeed.name, tenantShifts);
    }
    if (classSeed.version !== null) {
      assertVocabularyHas('version', classSeed.version, classSeed.name, tenantVersions);
    }
    for (const sectionSeed of classSeed.sections) {
      if (sectionSeed.group !== null) {
        assertVocabularyHas('group', sectionSeed.group, classSeed.name, tenantGroups);
      }
    }
  }

  let rosterIndex = 0;
  for (const classSeed of DEMO_CLASSES) {
    // [33.5.1] `shift`/`version` are part of the where clause, not just the
    // create payload: two `DEMO_CLASSES` entries can share a name and year
    // (see "Class 8" above), and the DB's own unique index tells them apart
    // by shift/version too (`NULLS NOT DISTINCT`). Without this, a re-run
    // would resolve both entries to whichever row `findOne` happens to
    // return first, instead of the one this seed entry actually owns.
    let klass = await classRepository.findOne({
      where: {
        name: classSeed.name,
        academic_year_id: year.id,
        tenant_id: schoolId,
        shift: classSeed.shift ?? IsNull(),
        version: classSeed.version ?? IsNull(),
      },
      withDeleted: true,
    });
    if (!klass) {
      klass = classRepository.create({
        name: classSeed.name,
        numeric_grade: classSeed.numericGrade,
        shift: classSeed.shift,
        version: classSeed.version,
        academic_year_id: year.id,
        tenant_id: schoolId,
      });
      await classRepository.save(klass);
      result.classes += 1;
    } else if (klass.deleted_at) {
      klass.shift = classSeed.shift;
      klass.version = classSeed.version;
      await classRepository.save(undelete(klass));
    }

    for (const sectionSeed of classSeed.sections) {
      // `group` deliberately left out of this lookup — see `sections.tab.ts`:
      // it's not part of `class_sections`' own unique index, so sections
      // stay unique by name within a class regardless of group.
      let section = await findLivePreferred(classSectionRepository, {
        class_id: klass.id,
        section_name: sectionSeed.name,
        tenant_id: schoolId,
      });
      if (!section) {
        section = classSectionRepository.create({
          class_id: klass.id,
          section_name: sectionSeed.name,
          capacity: 30,
          group_name: sectionSeed.group,
          tenant_id: schoolId,
        });
        await classSectionRepository.save(section);
        result.sections += 1;
      } else if (section.deleted_at) {
        section.group_name = sectionSeed.group;
        await classSectionRepository.save(undelete(section));
      }

      // Only ever moves forward, so two students in the same section can
      // never be handed the same resolved roll.
      let nextRoll = 1;
      for (let slot = 0; slot < DEMO_STUDENTS_PER_SECTION; slot += 1) {
        const registrationNumber = `${DEMO_ACADEMIC_YEAR.name}-${String(rosterIndex + 1).padStart(4, '0')}`;
        const fullName = DEMO_STUDENT_NAMES[rosterIndex % DEMO_STUDENT_NAMES.length] as string;
        const guardian = guardians[rosterIndex % guardians.length];
        rosterIndex += 1;

        const existing = await studentRepository.findOne({
          where: { registration_number: registrationNumber, tenant_id: schoolId },
          withDeleted: true,
        });
        if (existing) {
          if (existing.deleted_at) await studentRepository.save(undelete(existing));
          continue;
        }

        const rollNumber = await findFreeRollNumber(studentRepository, section.id, nextRoll);
        nextRoll = rollNumber + 1;

        const student = studentRepository.create({
          full_name: fullName,
          registration_number: registrationNumber,
          roll_number: rollNumber,
          class_section_id: section.id,
          date_of_birth: new Date(`${2012 - classSeed.numericGrade + 6}-03-15`),
          gender: rosterIndex % 2 === 0 ? 'female' : 'male',
          home_address: `House ${rosterIndex}, Road ${classSeed.numericGrade}, Dhaka`,
          tenant_id: schoolId,
          // `cascade: ['insert']` on the relation writes the
          // student_guardians join row as part of this save.
          guardians: guardian ? [guardian] : [],
        });
        await studentRepository.save(student);
        result.students += 1;
      }
    }
  }

  if (result.students > 0 || result.classes > 0) {
    console.log(
      `  Demo roster: +${result.classes} classes, +${result.sections} sections, ` +
        `+${result.students} students, +${result.guardians} guardians`,
    );
  }
  return result;
}

/** [9.11] Deterministic attendance ground truth, seeded on top of
 * `ensureDemoStudents`'s "Class 6" / section "A" roster (exactly
 * {@link DEMO_STUDENTS_PER_SECTION} students — the low-attendance-flag
 * assertion below depends on there being exactly one below threshold).
 *
 * Every date is derived from {@link ATTENDANCE_SEED_MONTH}, never
 * `new Date()` — the same command run twice must produce byte-identical
 * rows. Every *working day of the whole month* is marked, not an
 * arbitrary sub-range — `GET /attendance/flags/low` (and the reports
 * page built on it) computes a percentage over the whole calendar month
 * it's asked about, so a partially-marked month would dilute every
 * student's percentage with unmarked days that read as absent under the
 * default `WORKING_DAYS` denominator, flagging students this seed never
 * intended to flag. */
export const ATTENDANCE_SEED_MONTH = '2026-03';

/** SHA-256-hashed and stored on the seeded ACTIVE device — kept obviously
 * fake and duplicated (not imported) from `e2e/seed-contract.ts`;
 * `seed.util.spec.ts` asserts the two stay equal. */
export const SEED_DEVICE_KEY = 'bd_dev_seed_0000000000000000000000000000';

const ATTENDANCE_SEED_SUBJECTS: readonly { code: string; nameEn: string; nameBn: string }[] = [
  { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
  { code: 'ENG', nameEn: 'English', nameBn: 'ইংরেজি' },
  { code: 'MATH', nameEn: 'Mathematics', nameBn: 'গণিত' },
  { code: 'SCI', nameEn: 'Science', nameBn: 'বিজ্ঞান' },
  { code: 'REL', nameEn: 'Religion', nameBn: 'ধর্ম' },
];

/** Two holidays, deliberately outside the attendance window below: one
 * single day, one multi-day, and one (`counts_as_working_day: true`) that
 * exercises the working-day calculator's own exception with real seeded
 * data rather than only a unit-test fixture. */
const ATTENDANCE_SEED_HOLIDAYS: readonly {
  name: string;
  startDate: string;
  endDate: string;
  countsAsWorkingDay: boolean;
}[] = [
  {
    name: 'Independence Day',
    startDate: '2026-03-26',
    endDate: '2026-03-26',
    countsAsWorkingDay: false,
  },
  {
    name: 'Eid Break',
    startDate: '2026-05-18',
    endDate: '2026-05-20',
    countsAsWorkingDay: false,
  },
  {
    name: 'Half-Yearly Exam Day',
    startDate: '2026-06-10',
    endDate: '2026-06-10',
    countsAsWorkingDay: true,
  },
];

/** Epoch-day arithmetic identical to `attendance-policy.util.ts`'s
 * private `toEpochDay` — duplicated rather than imported, since this
 * script has no dependency on the attendance module's internal utility
 * and a one-line date computation isn't worth adding one. */
function epochDay(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}

/** `0` = Sunday .. `6` = Saturday, matching `epochDay(0)` (1970-01-01)
 * being a Thursday (weekday 4). */
function weekdayOf(dateIso: string): number {
  return (((epochDay(dateIso) + 4) % 7) + 7) % 7;
}

const WEEKLY_OFF_WEEKDAY = 5; // Friday — Bangladesh's default weekly off.

function isHoliday(
  dateIso: string,
  holidays: readonly { startDate: string; endDate: string; countsAsWorkingDay: boolean }[],
): boolean {
  return holidays.some(
    (h) => !h.countsAsWorkingDay && dateIso >= h.startDate && dateIso <= h.endDate,
  );
}

/** Every working day (not Friday, not a non-working holiday) in
 * `monthIso` (`'YYYY-MM'`), ascending. */
function workingDaysInMonth(
  monthIso: string,
  holidays: readonly { startDate: string; endDate: string; countsAsWorkingDay: boolean }[],
): string[] {
  const [year, month] = monthIso.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${monthIso}-${String(day).padStart(2, '0')}`;
    if (weekdayOf(iso) !== WEEKLY_OFF_WEEKDAY && !isHoliday(iso, holidays)) {
      days.push(iso);
    }
  }
  return days;
}

/** Every working day of {@link ATTENDANCE_SEED_MONTH} — computed once so
 * {@link ATTENDANCE_SEED_ABSENT_DATE} below and `ensureAttendanceSeed`'s
 * own loop can never disagree about which date a given index actually is.
 * `ATTENDANCE_SEED_HOLIDAYS` is defined above this, so its one March
 * holiday is already excluded here. */
const ATTENDANCE_SEED_WORKING_DAYS = workingDaysInMonth(
  ATTENDANCE_SEED_MONTH,
  ATTENDANCE_SEED_HOLIDAYS,
);

/** Roll 1's one seeded ABSENT day — `e2e/seed-contract.ts` duplicates this
 * literal (not imported — production code never imports from `e2e/`) and
 * `seed.util.spec.ts` asserts the two stay equal, the same drift-guard
 * shape as {@link SEED_DEVICE_KEY}. */
export const ATTENDANCE_SEED_ABSENT_DATE = ATTENDANCE_SEED_WORKING_DAYS[7];

/** One entry per seeded day, ascending, one row per working day of
 * {@link ATTENDANCE_SEED_MONTH} (26 of them, once the one March holiday
 * is excluded).
 *
 * Distribution, against exactly 3 students (`DEMO_STUDENTS_PER_SECTION`):
 * - student 0 (roll 1, `parent@biddaloy.test`'s linked child): PRESENT
 *   except one ABSENT day — a real absence on the one child this seed's
 *   guardian account can actually see in the portal.
 * - student 1 (roll 2): PRESENT except two LATE days and one LEAVE day —
 *   exercises every status in one roster.
 * - student 2 (roll 3): mostly ABSENT — the single student below the
 *   `lowAttendanceThresholdPercent` default (75%), so the flags-list
 *   assertion can expect a count of exactly 1 rather than "at least one".
 *   Marking every working day of the month (not a sub-range) matters
 *   here: `GET /attendance/flags/low` computes over the whole month it's
 *   asked about, so any unmarked working day would otherwise read as an
 *   absence under the default `WORKING_DAYS` denominator and drag every
 *   student's percentage down, flagging students this seed never
 *   intended to flag.
 */
function statusForDay(studentIndex: number, dayIndex: number): AttendanceStatus {
  if (studentIndex === 0) {
    // Roll 1 — `ensureDemoStudents` links the tenant's *first* roster slot
    // to `guardians[0]`, which is in turn linked to `parent@biddaloy.test`
    // (see that function's own comment). One ABSENT day gives the portal
    // journey ([9.11]) a real absence to find on this exact child, rather
    // than a roster where the only linked child is always PRESENT.
    return dayIndex === 7 ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT;
  }
  if (studentIndex === 1) {
    if (dayIndex === 3 || dayIndex === 9) return AttendanceStatus.LATE;
    if (dayIndex === 12) return AttendanceStatus.LEAVE;
    return AttendanceStatus.PRESENT;
  }
  // studentIndex === 2: present roughly one day in three — comfortably
  // below the 75% threshold regardless of exactly how many working days
  // the month turns out to have.
  return dayIndex % 3 === 0 ? AttendanceStatus.PRESENT : AttendanceStatus.ABSENT;
}

export interface AttendanceSeedRepositories {
  subjectRepository: Repository<Subject>;
  schoolHolidayRepository: Repository<CalendarEvent>;
  teacherRepository: Repository<Teacher>;
  teacherClassSectionRepository: Repository<TeacherClassSection>;
  attendanceSessionRepository: Repository<AttendanceSession>;
  attendanceRecordRepository: Repository<AttendanceRecord>;
  attendanceDeviceRepository: Repository<AttendanceDevice>;
}

export interface AttendanceSeedParams {
  schoolId: string;
  academicYearId: string;
  /** "Class 6" / section "A" — see this function's own docstring. */
  sectionId: string;
  /** Exactly `DEMO_STUDENTS_PER_SECTION` ids, in roll-number order —
   * index 0 is roll 1, and so on. */
  studentIds: readonly string[];
  teacherUserId: string;
}

export interface AttendanceSeedResult {
  subjects: number;
  holidays: number;
  sessions: number;
  records: number;
  devices: number;
}

/** Idempotent, same find-or-create shape as every other `ensure*` in this
 * file. Everything is scoped to `params.schoolId`. */
export async function ensureAttendanceSeed(
  repos: AttendanceSeedRepositories,
  params: AttendanceSeedParams,
): Promise<AttendanceSeedResult> {
  const { schoolId, academicYearId, sectionId, studentIds, teacherUserId } = params;
  const result: AttendanceSeedResult = {
    subjects: 0,
    holidays: 0,
    sessions: 0,
    records: 0,
    devices: 0,
  };

  // --- subjects --------------------------------------------------------
  for (const { code, nameEn, nameBn } of ATTENDANCE_SEED_SUBJECTS) {
    const existing = await repos.subjectRepository.findOne({
      where: { tenant_id: schoolId, code },
      withDeleted: true,
    });
    if (!existing) {
      await repos.subjectRepository.save(
        repos.subjectRepository.create({
          tenant_id: schoolId,
          code,
          name_en: nameEn,
          name_bn: nameBn,
        }),
      );
      result.subjects += 1;
    } else if (existing.deleted_at) {
      await repos.subjectRepository.save(undelete(existing));
    }
  }

  // --- holidays ----------------------------------------------------------
  for (const holiday of ATTENDANCE_SEED_HOLIDAYS) {
    const existing = await repos.schoolHolidayRepository.findOne({
      where: { tenant_id: schoolId, name: holiday.name },
      withDeleted: true,
    });
    if (!existing) {
      await repos.schoolHolidayRepository.save(
        repos.schoolHolidayRepository.create({
          tenant_id: schoolId,
          academic_year_id: academicYearId,
          name: holiday.name,
          start_date: holiday.startDate,
          end_date: holiday.endDate,
          counts_as_working_day: holiday.countsAsWorkingDay,
          // [17.1.2] D9 — a draft (published_at IS NULL) holiday never
          // affects working days; seeded demo holidays must be published
          // immediately so ATTENDANCE_SEED_WORKING_DAYS stays correct.
          published_at: new Date(),
        }),
      );
      result.holidays += 1;
    } else if (existing.deleted_at) {
      // Same D9 reasoning as the create branch above: a restored holiday
      // must come back published, not as an unpublished draft, or
      // ATTENDANCE_SEED_WORKING_DAYS goes stale silently.
      const restored = undelete(existing);
      restored.published_at ??= new Date();
      await repos.schoolHolidayRepository.save(restored);
    }
  }

  // --- teacher profile + section mapping ---------------------------------
  // Without this, every teacher-scoped attendance route 403s for the
  // seeded `teacher@biddaloy.test` account — `AttendanceAccessService`
  // resolves markable sections through `teacher_class_sections`, not the
  // JWT role alone.
  let teacher = await repos.teacherRepository.findOne({
    where: { user_id: teacherUserId },
    withDeleted: true,
  });
  if (!teacher) {
    teacher = repos.teacherRepository.create({
      user_id: teacherUserId,
      employee_id: 'SEED-TEACHER-0001',
      designations: [TeacherDesignation.CLASS_TEACHER],
      tenant_id: schoolId,
    });
    await repos.teacherRepository.save(teacher);
  } else if (teacher.deleted_at) {
    await repos.teacherRepository.save(undelete(teacher));
  }

  const existingMapping = await repos.teacherClassSectionRepository.findOne({
    where: { teacher_id: teacher.id, section_id: sectionId, subject_id: IsNull() },
  });
  if (!existingMapping) {
    await repos.teacherClassSectionRepository.save(
      repos.teacherClassSectionRepository.create({
        teacher_id: teacher.id,
        section_id: sectionId,
        tenant_id: schoolId,
        subject_id: null,
      }),
    );
  }

  // --- attendance sessions + records --------------------------------
  const workingDays = ATTENDANCE_SEED_WORKING_DAYS;
  for (const [dayIndex, dateIso] of workingDays.entries()) {
    let session = await repos.attendanceSessionRepository.findOne({
      where: { tenant_id: schoolId, section_id: sectionId, date: dateIso, period_no: IsNull() },
    });
    if (!session) {
      session = repos.attendanceSessionRepository.create({
        tenant_id: schoolId,
        section_id: sectionId,
        date: dateIso,
        period_no: null,
        source: AttendanceSource.TEACHER,
        state: AttendanceSessionState.FINALIZED,
        marked_by_user_id: teacherUserId,
        // Derived from the session's own date, not `new Date()` — two
        // seed runs must write the identical timestamp.
        marked_at: new Date(`${dateIso}T12:00:00Z`),
        finalized_at: new Date(`${dateIso}T12:00:00Z`),
      });
      await repos.attendanceSessionRepository.save(session);
      result.sessions += 1;
    }

    for (const [studentIndex, studentId] of studentIds.entries()) {
      const existingRecord = await repos.attendanceRecordRepository.findOne({
        where: { session_id: session.id, student_id: studentId },
      });
      if (existingRecord) continue;

      const status = statusForDay(studentIndex, dayIndex);
      await repos.attendanceRecordRepository.save(
        repos.attendanceRecordRepository.create({
          tenant_id: schoolId,
          session_id: session.id,
          student_id: studentId,
          date: dateIso,
          status,
          minutes_late: status === AttendanceStatus.LATE ? 10 : null,
          source: AttendanceSource.TEACHER,
          recorded_by_user_id: teacherUserId,
        }),
      );
      result.records += 1;
    }
  }

  // --- devices ---------------------------------------------------------
  const activeDeviceName = 'Seed Front-Gate Scanner';
  const existingActiveDevice = await repos.attendanceDeviceRepository.findOne({
    where: { tenant_id: schoolId, name: activeDeviceName },
  });
  if (!existingActiveDevice) {
    await repos.attendanceDeviceRepository.save(
      repos.attendanceDeviceRepository.create({
        tenant_id: schoolId,
        name: activeDeviceName,
        kind: AttendanceDeviceKind.RFID,
        token_hash: hashDeviceKey(SEED_DEVICE_KEY),
        token_last4: SEED_DEVICE_KEY.slice(-4),
        section_id: sectionId,
        roster_access: true,
        status: AttendanceDeviceStatus.ACTIVE,
      }),
    );
    result.devices += 1;
  }

  const revokedDeviceKey = 'bd_dev_seed_revoked_0000000000000000000';
  const revokedDeviceName = 'Seed Retired Scanner';
  const existingRevokedDevice = await repos.attendanceDeviceRepository.findOne({
    where: { tenant_id: schoolId, name: revokedDeviceName },
  });
  if (!existingRevokedDevice) {
    await repos.attendanceDeviceRepository.save(
      repos.attendanceDeviceRepository.create({
        tenant_id: schoolId,
        name: revokedDeviceName,
        kind: AttendanceDeviceKind.BIOMETRIC,
        token_hash: hashDeviceKey(revokedDeviceKey),
        token_last4: revokedDeviceKey.slice(-4),
        roster_access: false,
        status: AttendanceDeviceStatus.REVOKED,
        revoked_at: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    result.devices += 1;
  }

  if (result.sessions > 0 || result.subjects > 0 || result.devices > 0) {
    console.log(
      `  Attendance seed: +${result.subjects} subjects, +${result.holidays} holidays, ` +
        `+${result.sessions} sessions, +${result.records} records, +${result.devices} devices`,
    );
  }
  return result;
}

// ===========================================================================
// [17.2.6] Platform public-holiday set + demo academic terms/events
// ===========================================================================

export interface PublicHolidaySeedRepositories {
  publicHolidaySetRepository: Repository<PublicHolidaySet>;
  publicHolidayEntryRepository: Repository<PublicHolidayEntry>;
}

/** Idempotent, same find-or-create shape as every other `ensure*` in this
 * file: safe to re-run against a database that already has this
 * country/year set (`(country, year)` is a unique index — see
 * `PublicHolidaySet`'s own docstring).
 *
 * Unlike [17.2.4]'s `PublicHolidaysService.fetchIntoSet`, this writes the
 * set **already published** (`published_at` set immediately) — a fresh
 * dev/CI environment has no SUPER_ADMIN clicking "Publish" by hand, and a
 * draft set is invisible to every tenant's `suggest()` call (D9-equivalent
 * rule for holiday sets), so `yarn seed` would otherwise produce a set no
 * demo tenant can ever see. */
export async function ensurePublicHolidaySet(
  repos: PublicHolidaySeedRepositories,
  country: string,
  year: number,
  entries: readonly SeedPublicHolidayEntry[],
): Promise<PublicHolidaySet> {
  let set = await repos.publicHolidaySetRepository.findOne({ where: { country, year } });
  if (!set) {
    set = repos.publicHolidaySetRepository.create({
      country,
      year,
      source: PublicHolidaySource.MANUAL,
      published_at: new Date(),
      fetched_at: new Date(),
    });
    set = await repos.publicHolidaySetRepository.save(set);
    console.log(`  Public holiday set: ${country} ${year} (${set.id})`);
  } else if (!set.published_at) {
    set.published_at = new Date();
    set = await repos.publicHolidaySetRepository.save(set);
  }

  const existingEntries = await repos.publicHolidayEntryRepository.find({
    where: { set_id: set.id },
  });
  const existingByDate = new Map(existingEntries.map((entry) => [entry.date, entry]));
  const missing = entries.filter((entry) => !existingByDate.has(entry.date));
  if (missing.length > 0) {
    await repos.publicHolidayEntryRepository.save(
      missing.map((entry) =>
        repos.publicHolidayEntryRepository.create({
          set_id: set!.id,
          date: entry.date,
          end_date: entry.end_date,
          name: entry.name,
          name_bn: entry.name_bn,
        }),
      ),
    );
  }

  // A matching `date` alone doesn't mean the entry is up to date — if the
  // fixture later corrects `end_date`/`name`/`name_bn`, a re-run of this
  // seed used to leave the stale values in place forever, silently.
  // Reconcile any that actually changed.
  const changed = entries.filter((entry) => {
    const existing = existingByDate.get(entry.date);
    return (
      existing &&
      (existing.end_date !== entry.end_date ||
        existing.name !== entry.name ||
        existing.name_bn !== entry.name_bn)
    );
  });
  if (changed.length > 0) {
    await repos.publicHolidayEntryRepository.save(
      changed.map((entry) => {
        const existing = existingByDate.get(entry.date)!;
        return { ...existing, end_date: entry.end_date, name: entry.name, name_bn: entry.name_bn };
      }),
    );
  }

  return set;
}

export interface CalendarDemoSeedRepositories {
  academicTermRepository: Repository<AcademicTerm>;
  calendarEventRepository: Repository<CalendarEvent>;
  calendarEventClassRepository: Repository<CalendarEventClass>;
}

export interface CalendarDemoSeedParams {
  schoolId: string;
  academicYearId: string;
  /** Class ids the seeded EXAM event is scoped to — exactly two, matching
   * the issue's "one EXAM scoped two classes" step. */
  examClassIds: readonly [string, string];
}

export interface CalendarDemoSeedResult {
  terms: number;
  events: number;
}

/** Three demo `AcademicTerm`s spanning `DEMO_ACADEMIC_YEAR` plus a demo
 * `CalendarEvent` of each remaining type ([17.1.2]'s `CalendarEventType`)
 * so a fresh environment's calendar UI has something realistic to render:
 * an EXAM scoped to two classes, a staff-only MEETING, a DEADLINE, and one
 * unpublished draft. `HOLIDAY` rows are deliberately left to
 * `ensureAttendanceSeed`/`ensurePublicHolidaySet` above — this function
 * only adds the event *types* [17.x] introduced on top of the pre-existing
 * holiday seed, so `ATTENDANCE_SEED_HOLIDAYS`'s working-day math is
 * untouched. Idempotent, same find-or-create shape as the rest of this
 * file. */
export async function ensureCalendarDemoSeed(
  repos: CalendarDemoSeedRepositories,
  params: CalendarDemoSeedParams,
): Promise<CalendarDemoSeedResult> {
  const { schoolId, academicYearId, examClassIds } = params;
  const result: CalendarDemoSeedResult = { terms: 0, events: 0 };

  // --- terms -------------------------------------------------------------
  const termSeeds: readonly { seq: number; name: string; start: string; end: string }[] = [
    { seq: 1, name: 'First Term', start: '2026-01-01', end: '2026-04-30' },
    { seq: 2, name: 'Second Term', start: '2026-05-01', end: '2026-08-31' },
    { seq: 3, name: 'Third Term', start: '2026-09-01', end: '2026-12-31' },
  ];
  for (const termSeed of termSeeds) {
    const existing = await findLivePreferred(repos.academicTermRepository, {
      tenant_id: schoolId,
      academic_year_id: academicYearId,
      seq: termSeed.seq,
    } as FindOptionsWhere<AcademicTerm>);
    if (!existing) {
      await repos.academicTermRepository.save(
        repos.academicTermRepository.create({
          tenant_id: schoolId,
          academic_year_id: academicYearId,
          seq: termSeed.seq,
          name: termSeed.name,
          start_date: termSeed.start,
          end_date: termSeed.end,
        } as Partial<AcademicTerm>),
      );
      result.terms += 1;
    } else if (existing.deleted_at) {
      await repos.academicTermRepository.save(undelete(existing));
    }
  }

  // --- events --------------------------------------------------------------
  async function ensureEvent(seed: {
    name: string;
    type: CalendarEventType;
    audience: CalendarAudience;
    start: string;
    end: string;
    countsAsWorkingDay: boolean;
    published: boolean;
  }): Promise<CalendarEvent> {
    let event = await repos.calendarEventRepository.findOne({
      where: { tenant_id: schoolId, name: seed.name },
      withDeleted: true,
    });
    if (!event) {
      event = repos.calendarEventRepository.create({
        tenant_id: schoolId,
        academic_year_id: academicYearId,
        type: seed.type,
        audience: seed.audience,
        name: seed.name,
        start_date: seed.start,
        end_date: seed.end,
        counts_as_working_day: seed.countsAsWorkingDay,
        published_at: seed.published ? new Date() : null,
      });
      event = await repos.calendarEventRepository.save(event);
      result.events += 1;
    } else if (event.deleted_at) {
      event = await repos.calendarEventRepository.save(undelete(event));
    }
    return event;
  }

  const examEvent = await ensureEvent({
    name: 'Half-Yearly Examination',
    type: CalendarEventType.EXAM,
    audience: CalendarAudience.ALL,
    start: '2026-06-15',
    end: '2026-06-20',
    countsAsWorkingDay: true,
    published: true,
  });
  for (const classId of examClassIds) {
    const existingLink = await repos.calendarEventClassRepository.findOne({
      where: { event_id: examEvent.id, class_id: classId },
    });
    if (!existingLink) {
      await repos.calendarEventClassRepository.save(
        repos.calendarEventClassRepository.create({
          event_id: examEvent.id,
          class_id: classId,
          tenant_id: schoolId,
        }),
      );
    }
  }

  await ensureEvent({
    name: 'Staff Planning Meeting',
    type: CalendarEventType.MEETING,
    audience: CalendarAudience.STAFF,
    start: '2026-07-05',
    end: '2026-07-05',
    countsAsWorkingDay: true,
    published: true,
  });

  await ensureEvent({
    name: 'Annual Report Submission Deadline',
    type: CalendarEventType.DEADLINE,
    audience: CalendarAudience.ALL,
    start: '2026-11-30',
    end: '2026-11-30',
    countsAsWorkingDay: true,
    published: true,
  });

  await ensureEvent({
    name: 'Winter Fair (Draft)',
    type: CalendarEventType.EVENT,
    audience: CalendarAudience.ALL,
    start: '2026-12-20',
    end: '2026-12-21',
    countsAsWorkingDay: true,
    published: false,
  });

  if (result.terms > 0 || result.events > 0) {
    console.log(`  Calendar demo seed: +${result.terms} terms, +${result.events} events`);
  }
  return result;
}

/** [20.4.1] The standard BD NCTB letter-grade bands, GPA-on-5 scale.
 * `F` carries `gpa: null` deliberately (D4): a fail band, not a 0.00. */
export const BD_NCTB_BANDS: readonly {
  grade: string;
  gpa: string | null;
  percent_from: number;
  percent_to: number;
  is_fail: boolean;
}[] = [
  { grade: 'A+', gpa: '5.00', percent_from: 80, percent_to: 100, is_fail: false },
  { grade: 'A', gpa: '4.00', percent_from: 70, percent_to: 79, is_fail: false },
  { grade: 'A-', gpa: '3.50', percent_from: 60, percent_to: 69, is_fail: false },
  { grade: 'B', gpa: '3.00', percent_from: 50, percent_to: 59, is_fail: false },
  { grade: 'C', gpa: '2.00', percent_from: 40, percent_to: 49, is_fail: false },
  { grade: 'D', gpa: '1.00', percent_from: 33, percent_to: 39, is_fail: false },
  { grade: 'F', gpa: null, percent_from: 0, percent_to: 32, is_fail: true },
];

export interface GradingDemoSeedRepositories {
  gradingScaleRepository: Repository<GradingScale>;
  gradingBandRepository: Repository<GradingBand>;
  subjectRepository: Repository<Subject>;
  classSubjectRepository: Repository<ClassSubject>;
}

export interface GradingDemoSeedResult {
  scales: number;
  bands: number;
  gradedOnlySubjects: number;
}

/** Find-or-create one scale (by its natural key: name/year/class) with the
 * BD NCTB bands attached, idempotent the same way every other `ensure*`
 * helper in this file is. */
async function ensureBdNctbScale(
  repos: Pick<GradingDemoSeedRepositories, 'gradingScaleRepository' | 'gradingBandRepository'>,
  schoolId: string,
  academicYearId: string,
  classId: string | null,
  name: string,
): Promise<{ createdScale: boolean; createdBands: number }> {
  // Look up by (tenant, academic year, class) only — not name — since the
  // scope alone is what the one-default-scale-per-scope DB constraint
  // enforces. Filtering by name too could miss an existing scale in that
  // scope and attempt a second insert, which the constraint then rejects.
  const scope = {
    tenant_id: schoolId,
    academic_year_id: academicYearId,
    class_id: classId ?? IsNull(),
  };
  // Only a dead row carrying the demo name may be restored — a deleted
  // custom scale stays deleted. The unique indexes are partial on
  // `deleted_at IS NULL`, so a fresh demo row can coexist with it.
  let scale =
    (await repos.gradingScaleRepository.findOne({ where: scope })) ??
    (await repos.gradingScaleRepository.findOne({
      where: { ...scope, name },
      withDeleted: true,
    }));
  let createdScale = false;
  if (!scale) {
    scale = repos.gradingScaleRepository.create({
      tenant_id: schoolId,
      academic_year_id: academicYearId,
      class_id: classId,
      name,
      revision: 1,
    });
    await repos.gradingScaleRepository.save(scale);
    createdScale = true;
  } else if (scale.deleted_at) {
    await repos.gradingScaleRepository.save(undelete(scale));
  } else if (scale.name !== name) {
    // A scale already occupies this scope under a different name — it's not
    // the demo scale this helper seeds. Leave it untouched rather than
    // attaching BD NCTB bands to someone else's scale.
    return { createdScale: false, createdBands: 0 };
  }

  let createdBands = 0;
  for (const [index, band] of BD_NCTB_BANDS.entries()) {
    const sequence = index + 1;
    let row = await findLivePreferred(repos.gradingBandRepository, {
      tenant_id: schoolId,
      scale_id: scale.id,
      sequence,
    });
    if (!row) {
      row = repos.gradingBandRepository.create({
        tenant_id: schoolId,
        scale_id: scale.id,
        sequence,
        grade: band.grade,
        gpa: band.gpa,
        percent_from: band.percent_from,
        percent_to: band.percent_to,
        is_fail: band.is_fail,
        comment: null,
      });
      await repos.gradingBandRepository.save(row);
      createdBands += 1;
    } else if (row.deleted_at) {
      await repos.gradingBandRepository.save(undelete(row));
    }
  }

  return { createdScale, createdBands };
}

/** [20.4.1] Demo grading data for the default tenant/year: the BD NCTB
 * scale as the year's default (`class_id: null`, D1), the same bands again
 * as a per-class override (exercising the override path Epic 19.0's screens
 * need to render), and one graded-only subject ("Physical Education") on
 * that override class.
 *
 * `academicYearId`/`overrideClassId` are passed in rather than looked up
 * here — same shape `ensureCalendarDemoSeed` takes — so this stays testable
 * without depending on `ensureDemoStudents`'s own lookup order. */
export async function ensureGradingDemoSeed(
  repos: GradingDemoSeedRepositories,
  schoolId: string,
  academicYearId: string,
  overrideClassId: string,
): Promise<GradingDemoSeedResult> {
  const defaultResult = await ensureBdNctbScale(repos, schoolId, academicYearId, null, 'BD NCTB');
  const overrideResult = await ensureBdNctbScale(
    repos,
    schoolId,
    academicYearId,
    overrideClassId,
    'BD NCTB (Class override)',
  );

  // --- one graded-only subject, on the override class -------------------
  // `subjects(tenant_id, code)` and `class_subjects(class_id, subject_id,
  // academic_year_id)` are both partial unique indexes — go through
  // `findLivePreferred`, not a raw `withDeleted` findOne, or a re-run risks
  // undeleting a dead row into a collision with a live one that already
  // owns the key (see that helper's own docstring above).
  let subject = await findLivePreferred(repos.subjectRepository, {
    tenant_id: schoolId,
    code: 'PE',
  });
  if (!subject) {
    subject = repos.subjectRepository.create({
      tenant_id: schoolId,
      code: 'PE',
      name_en: 'Physical Education',
      name_bn: 'শারীরিক শিক্ষা',
      is_active: true,
    });
    await repos.subjectRepository.save(subject);
  } else if (subject.deleted_at) {
    await repos.subjectRepository.save(undelete(subject));
  }

  let gradedOnlySubjects = 0;
  let classSubject = await findLivePreferred(repos.classSubjectRepository, {
    tenant_id: schoolId,
    class_id: overrideClassId,
    subject_id: subject.id,
    academic_year_id: academicYearId,
  });
  if (!classSubject) {
    classSubject = repos.classSubjectRepository.create({
      tenant_id: schoolId,
      class_id: overrideClassId,
      subject_id: subject.id,
      academic_year_id: academicYearId,
      is_optional: false,
      is_graded_only: true,
    });
    await repos.classSubjectRepository.save(classSubject);
    gradedOnlySubjects += 1;
  } else {
    let dirty = false;
    if (classSubject.deleted_at) {
      undelete(classSubject);
      dirty = true;
    }
    if (!classSubject.is_graded_only) {
      classSubject.is_graded_only = true;
      dirty = true;
    }
    if (dirty) await repos.classSubjectRepository.save(classSubject);
  }

  const result: GradingDemoSeedResult = {
    scales: (defaultResult.createdScale ? 1 : 0) + (overrideResult.createdScale ? 1 : 0),
    bands: defaultResult.createdBands + overrideResult.createdBands,
    gradedOnlySubjects,
  };
  if (result.scales > 0 || result.bands > 0 || result.gradedOnlySubjects > 0) {
    console.log(
      `  Grading demo seed: +${result.scales} scales, +${result.bands} bands, ` +
        `+${result.gradedOnlySubjects} graded-only subjects`,
    );
  }
  return result;
}

export interface RoutineSeedRepositories {
  userRepository: Repository<User>;
  teacherRepository: Repository<Teacher>;
  subjectRepository: Repository<Subject>;
  classRepository: Repository<Class>;
  shiftRepository: Repository<Shift>;
  periodSlotRepository: Repository<PeriodSlot>;
  roomRepository: Repository<Room>;
  routineRepository: Repository<Routine>;
  routineSlotRepository: Repository<RoutineSlot>;
  routineSlotTeacherRepository: Repository<RoutineSlotTeacher>;
  routineSubstitutionRepository: Repository<RoutineSubstitution>;
  routineChangeRequestRepository: Repository<RoutineChangeRequest>;
}

export interface RoutineSeedParams {
  schoolId: string;
  academicYearId: string;
  classId: string; // the class both sections belong to — its shift_id is set here (D8's promotion column)
  sectionAId: string;
  sectionBId: string;
  primaryTeacherId: string; // an existing Teacher row (e.g. `ensureAttendanceSeed`'s teacher@biddaloy.test)
  requestedByUserId: string; // whoever "files" the substitution and change request
}

export interface RoutineSeedResult {
  shifts: number;
  periodSlots: number;
  rooms: number;
  teachers: number;
  routines: number;
  slots: number;
  substitutions: number;
  changeRequests: number;
}

/** Six period slots for the seeded "Morning" shift, sequence 1..6 — five
 * class periods and one `BREAK` ("Lunch") between periods 3 and 4. */
const ROUTINE_SEED_PERIODS: readonly {
  sequence: number;
  kind: PeriodSlotKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}[] = [
  {
    sequence: 1,
    kind: PeriodSlotKind.CLASS,
    name: null,
    starts_at: '08:00:00',
    ends_at: '08:40:00',
  },
  {
    sequence: 2,
    kind: PeriodSlotKind.CLASS,
    name: null,
    starts_at: '08:40:00',
    ends_at: '09:20:00',
  },
  {
    sequence: 3,
    kind: PeriodSlotKind.CLASS,
    name: null,
    starts_at: '09:20:00',
    ends_at: '10:00:00',
  },
  {
    sequence: 4,
    kind: PeriodSlotKind.BREAK,
    name: 'Lunch',
    starts_at: '10:00:00',
    ends_at: '10:30:00',
  },
  {
    sequence: 5,
    kind: PeriodSlotKind.CLASS,
    name: null,
    starts_at: '10:30:00',
    ends_at: '11:10:00',
  },
  {
    sequence: 6,
    kind: PeriodSlotKind.CLASS,
    name: null,
    starts_at: '11:10:00',
    ends_at: '11:50:00',
  },
];

/**
 * [21.11.1]: a published routine spanning two sections, deterministic
 * enough for `/routines` demo screens and for the workbook round-trip
 * fixture to exercise the same shapes real tenants hit — a co-taught
 * slot (two teachers on one `RoutineSlot`), a biweekly slot, a
 * cancellation substitution with no substitute, and one open change
 * request.
 *
 * Idempotent like every other `ensure*` helper here: every entity is
 * found-or-created by its own natural key before being written.
 *
 * Bails out entirely if the academic year already has a *live* routine
 * this helper didn't create (identified by name, `SEED_ROUTINE_NAME`
 * below) — `Routine`'s unique `(tenant_id, academic_year_id)` index means
 * there is at most one, so grafting fixture slots/teachers/substitutions/
 * change-requests onto someone else's real routine would silently
 * corrupt it rather than seed a fixture.
 */
const SEED_ROUTINE_NAME = 'Main routine';

export async function ensureRoutineSeed(
  repos: RoutineSeedRepositories,
  params: RoutineSeedParams,
): Promise<RoutineSeedResult> {
  const {
    schoolId,
    academicYearId,
    classId,
    sectionAId,
    sectionBId,
    primaryTeacherId,
    requestedByUserId,
  } = params;
  const result: RoutineSeedResult = {
    shifts: 0,
    periodSlots: 0,
    rooms: 0,
    teachers: 0,
    routines: 0,
    slots: 0,
    substitutions: 0,
    changeRequests: 0,
  };

  const liveRoutine = await repos.routineRepository.findOne({
    where: { tenant_id: schoolId, academic_year_id: academicYearId },
  });
  if (liveRoutine && liveRoutine.name !== SEED_ROUTINE_NAME) {
    console.warn(
      `  Routine seed: academic year already has a non-seed routine "${liveRoutine.name}", skipping.`,
    );
    return result;
  }

  // --- shift + period slots ------------------------------------------
  let shift = await findLivePreferred(repos.shiftRepository, {
    tenant_id: schoolId,
    name: 'Morning',
  });
  if (!shift) {
    shift = repos.shiftRepository.create({
      tenant_id: schoolId,
      name: 'Morning',
      day_starts_at: '08:00:00',
      day_ends_at: '13:00:00',
      sequence: 1,
    });
    await repos.shiftRepository.save(shift);
    result.shifts += 1;
  } else if (shift.deleted_at) {
    await repos.shiftRepository.save(undelete(shift));
  }

  // The client's grid builder (`/routines/$sectionId`) gates on
  // `section.class.shift_id` being set — without this, [21.2.1]'s
  // `classes.shift_id` promotion column stays null for every demo class
  // and the builder shows "no shift" instead of the seeded grid.
  const routineClass = await repos.classRepository.findOne({ where: { id: classId } });
  if (routineClass && routineClass.shift_id !== shift.id) {
    routineClass.shift_id = shift.id;
    await repos.classRepository.save(routineClass);
  }

  const periodSlots: PeriodSlot[] = [];
  for (const p of ROUTINE_SEED_PERIODS) {
    let slot = await repos.periodSlotRepository.findOne({
      where: { tenant_id: schoolId, shift_id: shift.id, sequence: p.sequence },
    });
    if (!slot) {
      slot = repos.periodSlotRepository.create({ ...p, shift_id: shift.id, tenant_id: schoolId });
      await repos.periodSlotRepository.save(slot);
      result.periodSlots += 1;
    }
    periodSlots.push(slot);
  }

  // --- rooms -----------------------------------------------------------
  const roomSeeds: readonly { building: string; room_no: string; capacity: number }[] = [
    { building: 'Building A', room_no: '101', capacity: 35 },
    { building: 'Building A', room_no: '102', capacity: 35 },
  ];
  const rooms: Room[] = [];
  for (const r of roomSeeds) {
    let room = await findLivePreferred(repos.roomRepository, {
      tenant_id: schoolId,
      building: r.building,
      room_no: r.room_no,
    });
    if (!room) {
      room = repos.roomRepository.create({ ...r, tenant_id: schoolId });
      await repos.roomRepository.save(room);
      result.rooms += 1;
    } else if (room.deleted_at) {
      await repos.roomRepository.save(undelete(room));
    }
    rooms.push(room);
  }

  // --- a second teacher, for the co-taught slot -------------------------
  let secondTeacherUser = await repos.userRepository.findOne({
    where: { email: 'routine-teacher2@biddaloy.test' },
    withDeleted: true,
  });
  if (!secondTeacherUser) {
    secondTeacherUser = repos.userRepository.create({
      email: 'routine-teacher2@biddaloy.test',
      full_name: 'Second Routine Teacher',
      // Never logged into directly — this account exists only to give the
      // co-taught slot a distinct teacher, unlike `teacher@biddaloy.test`
      // which is a real login fixture elsewhere in this file.
      password_hash: 'seed-only-not-a-real-login',
    });
    await repos.userRepository.save(secondTeacherUser);
  } else if (secondTeacherUser.deleted_at) {
    // `users.email` is a plain unique index (covers deleted rows too), so a
    // soft-deleted match still owns this email — restore it rather than
    // re-insert, same reasoning `findLivePreferred`'s docblock gives for
    // plain-unique-index entities.
    await repos.userRepository.save(undelete(secondTeacherUser));
  }
  let secondTeacher = await repos.teacherRepository.findOne({
    where: { user_id: secondTeacherUser.id },
    withDeleted: true,
  });
  if (!secondTeacher) {
    secondTeacher = repos.teacherRepository.create({
      user_id: secondTeacherUser.id,
      employee_id: 'SEED-TEACHER-0002',
      designations: [TeacherDesignation.SUBJECT_TEACHER],
      tenant_id: schoolId,
    });
    await repos.teacherRepository.save(secondTeacher);
    result.teachers += 1;
  } else if (secondTeacher.deleted_at) {
    await repos.teacherRepository.save(undelete(secondTeacher));
  }

  const mathSubject = await repos.subjectRepository.findOne({
    where: { tenant_id: schoolId, code: 'MATH' },
  });
  if (!mathSubject) {
    // No subject to hang slots off — `ensureAttendanceSeed` (which seeds
    // MATH) must run before this helper. Same "caller's job to sequence
    // this" contract as `ensureAttendanceSeed` itself has with
    // `ensureDemoStudents`.
    console.warn(
      '  Routine seed: no "MATH" subject found, skipping (run ensureAttendanceSeed first).',
    );
    return result;
  }

  // --- routine -----------------------------------------------------------
  // Keyed by name too, not just (tenant, year) — the early guard above
  // already ensures any live routine here is either absent or ours, but
  // a *soft-deleted* row for this year could still belong to someone
  // else, and `findLivePreferred`'s withDeleted fallback must not
  // undelete a stranger's routine into our fixture's identity.
  let routine = await findLivePreferred(repos.routineRepository, {
    tenant_id: schoolId,
    academic_year_id: academicYearId,
    name: SEED_ROUTINE_NAME,
  });
  if (!routine) {
    routine = repos.routineRepository.create({
      tenant_id: schoolId,
      academic_year_id: academicYearId,
      name: SEED_ROUTINE_NAME,
      state: RoutineState.PUBLISHED,
      published_at: new Date(),
    });
    await repos.routineRepository.save(routine);
    result.routines += 1;
  } else if (routine.deleted_at) {
    await repos.routineRepository.save(undelete(routine));
  }

  async function ensureSlot(spec: {
    section_id: string;
    period_slot_id: string;
    weekday: number;
    room_id: string | null;
    recurrence: SlotRecurrence;
    recurrence_offset: number;
    valid_from: string;
    valid_to: string | null;
  }): Promise<RoutineSlot> {
    let slot = await repos.routineSlotRepository.findOne({
      where: {
        tenant_id: schoolId,
        routine_id: routine!.id,
        section_id: spec.section_id,
        period_slot_id: spec.period_slot_id,
        weekday: spec.weekday,
        valid_from: spec.valid_from,
      },
    });
    if (!slot) {
      slot = repos.routineSlotRepository.create({
        ...spec,
        routine_id: routine!.id,
        subject_id: mathSubject!.id,
        tenant_id: schoolId,
      });
      await repos.routineSlotRepository.save(slot);
      result.slots += 1;
    }
    return slot;
  }

  async function ensureSlotTeacher(routineSlotId: string, teacherId: string): Promise<void> {
    const existing = await repos.routineSlotTeacherRepository.findOne({
      where: { routine_slot_id: routineSlotId, teacher_id: teacherId },
    });
    if (!existing) {
      await repos.routineSlotTeacherRepository.save(
        repos.routineSlotTeacherRepository.create({
          routine_slot_id: routineSlotId,
          teacher_id: teacherId,
          tenant_id: schoolId,
        }),
      );
    }
  }

  // A plain weekly slot, section A, period 1, Monday (weekday = 1) —
  // this is the one the substitution and change request below attach to.
  const mainSlot = await ensureSlot({
    section_id: sectionAId,
    period_slot_id: periodSlots[0]!.id,
    weekday: 1,
    room_id: rooms[0]!.id,
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
  });
  await ensureSlotTeacher(mainSlot.id, primaryTeacherId);

  // A biweekly slot, section A, period 2, Tuesday, second week of the cycle.
  const biweeklySlot = await ensureSlot({
    section_id: sectionAId,
    period_slot_id: periodSlots[1]!.id,
    weekday: 2,
    room_id: null,
    recurrence: SlotRecurrence.BIWEEKLY,
    recurrence_offset: 1,
    valid_from: '2026-01-01',
    valid_to: null,
  });
  await ensureSlotTeacher(biweeklySlot.id, primaryTeacherId);

  // Co-taught slot, section B, period 5, Monday: two teachers on one slot.
  const coTaughtSlot = await ensureSlot({
    section_id: sectionBId,
    period_slot_id: periodSlots[4]!.id,
    weekday: 1,
    room_id: rooms[1]!.id,
    recurrence: SlotRecurrence.WEEKLY,
    recurrence_offset: 0,
    valid_from: '2026-01-01',
    valid_to: null,
  });
  await ensureSlotTeacher(coTaughtSlot.id, primaryTeacherId);
  await ensureSlotTeacher(coTaughtSlot.id, secondTeacher.id);

  // --- one substitution: a cancellation, no substitute teacher ----------
  const existingSub = await repos.routineSubstitutionRepository.findOne({
    where: { routine_slot_id: mainSlot.id, date: '2026-02-09' },
  });
  if (!existingSub) {
    await repos.routineSubstitutionRepository.save(
      repos.routineSubstitutionRepository.create({
        routine_slot_id: mainSlot.id,
        date: '2026-02-09',
        substitute_teacher_id: null,
        is_cancelled: true,
        reason: 'Teacher on leave, period cancelled outright',
        created_by: requestedByUserId,
        tenant_id: schoolId,
      }),
    );
    result.substitutions += 1;
  }

  // --- one open change request -------------------------------------------
  // No `state` filter — once an admin resolves this seeded request, a
  // rerun must still recognize it as "already seeded" rather than
  // creating a duplicate OPEN one for the same slot/requester.
  const existingRequest = await repos.routineChangeRequestRepository.findOne({
    where: {
      routine_slot_id: mainSlot.id,
      requested_by: requestedByUserId,
    },
  });
  if (!existingRequest) {
    await repos.routineChangeRequestRepository.save(
      repos.routineChangeRequestRepository.create({
        routine_slot_id: mainSlot.id,
        requested_by: requestedByUserId,
        note: 'Requesting a swap with the next free period',
        state: ChangeRequestState.OPEN,
        tenant_id: schoolId,
      }),
    );
    result.changeRequests += 1;
  }

  const total =
    result.shifts +
    result.periodSlots +
    result.rooms +
    result.teachers +
    result.routines +
    result.slots;
  if (total > 0) {
    console.log(
      `  Routine seed: +${result.shifts} shifts, +${result.periodSlots} period slots, ` +
        `+${result.rooms} rooms, +${result.slots} slots, +${result.substitutions} substitutions, ` +
        `+${result.changeRequests} change requests`,
    );
  }
  return result;
}

/** [19.10.1] Demo exams/marks/results data so the marks-entry grid, the
 * progress screen and the guardian portal all have something real to
 * render — see the ticket's step 3:
 *
 * - one exam on the demo year's "Class 6", components across MATH and ENG
 *   (both MANUAL) plus one DERIVED `ATTENDANCE` component on MATH, so the
 *   marks grid shows a mix of enterable and read-only columns;
 * - marks entered for two sections ("A" and "B"), so grids/results are not
 *   confined to a single section;
 * - section A's grid left `SUBMITTED`, section B's left `DRAFT` — the
 *   progress screen needs at least one grid still outstanding to show
 *   anything;
 * - one `PUBLISHED` result (section A's roll 1), pinned against the demo
 *   BD NCTB scale `ensureGradingDemoSeed` already seeded, so the portal is
 *   not empty for `parent@biddaloy.test`'s linked child.
 */
export interface ExamsDemoSeedRepositories {
  subjectRepository: Repository<Subject>;
  examRepository: Repository<Exam>;
  examComponentRepository: Repository<ExamComponent>;
  markGridRepository: Repository<MarkGrid>;
  markRepository: Repository<Mark>;
  resultRepository: Repository<Result>;
  resultSubjectRepository: Repository<ResultSubject>;
  examScheduleRepository: Repository<ExamSchedule>;
}

export interface ExamsDemoSeedParams {
  schoolId: string;
  academicYearId: string;
  classId: string;
  /** "Class 6" section "A" and "B" ids, in that order. */
  sectionIds: readonly [string, string];
  /** Each section's students, in roll-number order — index 0 is roll 1. */
  sectionStudentIds: readonly [readonly string[], readonly string[]];
  gradingScaleId: string;
  gradingScaleRevision: number;
}

export interface ExamsDemoSeedResult {
  exams: number;
  components: number;
  grids: number;
  marks: number;
  results: number;
  schedules: number;
}

/** Idempotent, same find-or-create shape as every other `ensure*` in this
 * file. Everything is scoped to `params.schoolId`. */
export async function ensureExamsDemoSeed(
  repos: ExamsDemoSeedRepositories,
  params: ExamsDemoSeedParams,
): Promise<ExamsDemoSeedResult> {
  const { schoolId, academicYearId, classId, sectionIds, sectionStudentIds } = params;
  const result: ExamsDemoSeedResult = {
    exams: 0,
    components: 0,
    grids: 0,
    marks: 0,
    results: 0,
    schedules: 0,
  };

  // --- subjects (reuse the attendance seed's MATH/ENG if present) -------
  async function ensureSubject(code: string, nameEn: string, nameBn: string): Promise<Subject> {
    let subject = await findLivePreferred(repos.subjectRepository, { tenant_id: schoolId, code });
    if (!subject) {
      subject = repos.subjectRepository.create({
        tenant_id: schoolId,
        code,
        name_en: nameEn,
        name_bn: nameBn,
      });
      await repos.subjectRepository.save(subject);
    } else if (subject.deleted_at) {
      await repos.subjectRepository.save(undelete(subject));
    }
    return subject;
  }
  const math = await ensureSubject('MATH', 'Mathematics', 'গণিত');
  const english = await ensureSubject('ENG', 'English', 'ইংরেজি');

  // --- exam ---------------------------------------------------------------
  let exam = await repos.examRepository.findOne({
    where: {
      tenant_id: schoolId,
      academic_year_id: academicYearId,
      class_id: classId,
      name: 'First Term Exam',
    },
    withDeleted: true,
  });
  if (!exam) {
    exam = repos.examRepository.create({
      tenant_id: schoolId,
      academic_year_id: academicYearId,
      class_id: classId,
      academic_term_id: null,
      name: 'First Term Exam',
      kind: ExamKind.TERM,
      status: ExamStatus.PROCESSED,
      published_at: null,
    });
    await repos.examRepository.save(exam);
    result.exams += 1;
  } else if (exam.deleted_at) {
    await repos.examRepository.save(undelete(exam));
  }

  // --- components: MATH written, ENG written, MATH attendance (DERIVED) -
  const componentSpecs: {
    subject: Subject;
    name: string;
    kind: ExamComponentKind;
    source: ExamComponentSource;
    fullMarks: string;
    sequence: number;
  }[] = [
    {
      subject: math,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      fullMarks: '100.00',
      sequence: 1,
    },
    {
      subject: english,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      fullMarks: '100.00',
      sequence: 1,
    },
    {
      subject: math,
      name: 'Attendance',
      kind: ExamComponentKind.ATTENDANCE,
      source: ExamComponentSource.DERIVED,
      fullMarks: '10.00',
      sequence: 2,
    },
  ];
  const components: ExamComponent[] = [];
  for (const spec of componentSpecs) {
    let component = await repos.examComponentRepository.findOne({
      where: { exam_id: exam.id, subject_id: spec.subject.id, name: spec.name },
      withDeleted: true,
    });
    if (!component) {
      component = repos.examComponentRepository.create({
        tenant_id: schoolId,
        exam_id: exam.id,
        subject_id: spec.subject.id,
        name: spec.name,
        kind: spec.kind,
        source: spec.source,
        full_marks: spec.fullMarks,
        pass_marks: spec.source === ExamComponentSource.MANUAL ? '33.00' : null,
        sequence: spec.sequence,
      });
      await repos.examComponentRepository.save(component);
      result.components += 1;
    } else if (component.deleted_at) {
      await repos.examComponentRepository.save(undelete(component));
    }
    components.push(component);
  }

  // --- grids: section A submitted, section B left DRAFT -----------------
  const gridStates: readonly MarkGridState[] = [MarkGridState.SUBMITTED, MarkGridState.DRAFT];
  for (const [index, sectionId] of sectionIds.entries()) {
    for (const subject of [math, english]) {
      let grid = await repos.markGridRepository.findOne({
        where: { exam_id: exam.id, section_id: sectionId, subject_id: subject.id },
      });
      if (!grid) {
        grid = repos.markGridRepository.create({
          tenant_id: schoolId,
          exam_id: exam.id,
          section_id: sectionId,
          subject_id: subject.id,
          state: gridStates[index],
          submitted_by: null,
          submitted_at:
            gridStates[index] === MarkGridState.SUBMITTED
              ? new Date('2026-02-01T00:00:00.000Z')
              : null,
        });
        await repos.markGridRepository.save(grid);
        result.grids += 1;
      }
    }
  }

  // --- marks: every student, MATH written + ENG written; roll 1 of
  // section A's roll 2 is deliberately ABSENT (D10) --------------------
  for (const [sectionIndex, studentIds] of sectionStudentIds.entries()) {
    for (const [studentIndex, studentId] of studentIds.entries()) {
      for (const component of [components[0], components[1]]) {
        const isAbsent = sectionIndex === 0 && studentIndex === 1;
        const existing = await repos.markRepository.findOne({
          where: { exam_id: exam.id, student_id: studentId, component_id: component.id },
        });
        if (existing) continue;
        await repos.markRepository.save(
          repos.markRepository.create({
            tenant_id: schoolId,
            exam_id: exam.id,
            student_id: studentId,
            subject_id: component.subject_id,
            component_id: component.id,
            value: isAbsent ? null : '78.50',
            status: isAbsent ? MarkStatus.ABSENT : MarkStatus.PRESENT,
            entered_by: null,
          }),
        );
        result.marks += 1;
      }
    }
  }

  // --- one published result: section A, roll 1 --------------------------
  const publishedStudentId = sectionStudentIds[0][0];
  if (publishedStudentId) {
    let publishedResult = await repos.resultRepository.findOne({
      where: { exam_id: exam.id, student_id: publishedStudentId },
      withDeleted: true,
    });
    if (!publishedResult) {
      publishedResult = repos.resultRepository.create({
        tenant_id: schoolId,
        exam_id: exam.id,
        student_id: publishedStudentId,
        total_marks: '167.00',
        gpa: '4.50',
        grade: 'A',
        position: 1,
        is_fail: false,
        grading_scale_id: params.gradingScaleId,
        grading_scale_revision: params.gradingScaleRevision,
        rule_version: 'nctb-2026.1',
        computed_at: new Date('2026-02-10T00:00:00.000Z'),
        published_at: new Date('2026-02-11T00:00:00.000Z'),
      });
      await repos.resultRepository.save(publishedResult);
      result.results += 1;

      for (const [subject, obtained] of [
        [math, '89.00'],
        [english, '78.00'],
      ] as const) {
        const existingLine = await repos.resultSubjectRepository.findOne({
          where: { result_id: publishedResult.id, subject_id: subject.id },
        });
        if (!existingLine) {
          await repos.resultSubjectRepository.save(
            repos.resultSubjectRepository.create({
              tenant_id: schoolId,
              result_id: publishedResult.id,
              subject_id: subject.id,
              obtained,
              grade: 'A',
              gpa: '4.50',
              is_fail: false,
              is_fourth_subject: false,
            }),
          );
        }
      }
    } else if (publishedResult.deleted_at) {
      await repos.resultRepository.save(undelete(publishedResult));
    }
  }

  // --- [19.11.1] schedule: MATH and ENG both have components above, so
  // scheduling both makes this exam's schedule COMPLETE — the demo needs
  // at least one complete exam for the portal's family visibility rule to
  // have anything to show.
  const scheduleSpecs: { subject: Subject; date: string; venue: string | null }[] = [
    { subject: math, date: '2026-02-05', venue: 'Main Hall' },
    { subject: english, date: '2026-02-06', venue: null },
  ];
  for (const spec of scheduleSpecs) {
    let schedule = await repos.examScheduleRepository.findOne({
      where: { exam_id: exam.id, subject_id: spec.subject.id },
      withDeleted: true,
    });
    if (!schedule) {
      schedule = repos.examScheduleRepository.create({
        tenant_id: schoolId,
        exam_id: exam.id,
        subject_id: spec.subject.id,
        date: spec.date,
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        venue: spec.venue,
      });
      await repos.examScheduleRepository.save(schedule);
      result.schedules += 1;
    } else if (schedule.deleted_at) {
      await repos.examScheduleRepository.save(undelete(schedule));
    }
  }

  if (
    result.exams +
      result.components +
      result.grids +
      result.marks +
      result.results +
      result.schedules >
    0
  ) {
    console.log(
      `  Exams demo seed: +${result.exams} exams, +${result.components} components, ` +
        `+${result.grids} grids, +${result.marks} marks, +${result.results} results, ` +
        `+${result.schedules} schedules`,
    );
  }
  return result;
}

// ===========================================================================
// [22.3.6] Homework/syllabus demo data
// ===========================================================================

export interface HomeworkDemoSeedRepositories {
  homeworkRepository: Repository<Homework>;
  homeworkAssignmentRepository: Repository<HomeworkAssignment>;
  homeworkSubmissionRepository: Repository<HomeworkSubmission>;
  syllabusTopicRepository: Repository<SyllabusTopic>;
}

export interface HomeworkDemoSeedParams {
  schoolId: string;
  classId: string;
  subjectId: string;
  sectionId: string;
  /** Exactly {@link DEMO_STUDENTS_PER_SECTION} ids, roll-number order — same
   * roster `ensureAttendanceSeed` attaches to. Index 0/1 get a completed
   * submission, index 2 is left `NOT_SUBMITTED` against a past due date —
   * the fixture `homework-analytics.service.spec.ts`'s own "2 submitted, 1
   * defaulter -> 66%" example is drawn from. */
  studentIds: readonly string[];
}

export interface HomeworkDemoSeedResult {
  homework: number;
  assignments: number;
  submissions: number;
  syllabusTopics: number;
}

/** A fixed, safely-past due date (same "real 2026 date" convention as
 * `ATTENDANCE_SEED_MONTH`/`DEMO_ACADEMIC_YEAR`) — every seeded assignment is
 * already overdue, so the one `NOT_SUBMITTED` submission always reads as a
 * defaulter regardless of when the seed script actually runs. */
const HOMEWORK_SEED_DUE_DATE = '2026-01-20';
const HOMEWORK_SEED_ASSIGNED_DATE = '2026-01-10';

/** Idempotent, same find-or-create shape as every other `ensure*` in this
 * file: one `Homework`, one section-wide `HomeworkAssignment`, one
 * `HomeworkSubmission` per student (in every status a demo/CI database
 * should show: DONE, SUBMITTED, NOT_SUBMITTED-past-due), and a small
 * sample syllabus (DONE/DONE/PLANNED) for the same class/subject. */
export async function ensureHomeworkDemoSeed(
  repos: HomeworkDemoSeedRepositories,
  params: HomeworkDemoSeedParams,
): Promise<HomeworkDemoSeedResult> {
  const { schoolId, classId, subjectId, sectionId, studentIds } = params;
  const result: HomeworkDemoSeedResult = {
    homework: 0,
    assignments: 0,
    submissions: 0,
    syllabusTopics: 0,
  };

  const title = 'Chapter 3 Exercises';
  let homework = await repos.homeworkRepository.findOne({
    where: { tenant_id: schoolId, class_id: classId, subject_id: subjectId, title },
  });
  if (!homework) {
    homework = repos.homeworkRepository.create({
      tenant_id: schoolId,
      class_id: classId,
      subject_id: subjectId,
      title,
      description: 'Complete the odd-numbered problems and show your work.',
      grading_mode: HomeworkGradingMode.TICK,
      attachments: [],
    });
    await repos.homeworkRepository.save(homework);
    result.homework += 1;
  }

  let assignment = await repos.homeworkAssignmentRepository.findOne({
    where: { tenant_id: schoolId, homework_id: homework.id, section_id: sectionId },
  });
  if (!assignment) {
    assignment = repos.homeworkAssignmentRepository.create({
      tenant_id: schoolId,
      homework_id: homework.id,
      section_id: sectionId,
      student_id: null,
      assigned_date: HOMEWORK_SEED_ASSIGNED_DATE,
      due_date: HOMEWORK_SEED_DUE_DATE,
      status: HomeworkAssignmentStatus.ACTIVE,
    });
    await repos.homeworkAssignmentRepository.save(assignment);
    result.assignments += 1;
  }

  // index 0 -> DONE, index 1 -> SUBMITTED, index 2 (and anyone past it) ->
  // NOT_SUBMITTED (a defaulter, since HOMEWORK_SEED_DUE_DATE is in the past).
  const statusForSlot = (slot: number): HomeworkSubmissionStatus =>
    slot === 0
      ? HomeworkSubmissionStatus.DONE
      : slot === 1
        ? HomeworkSubmissionStatus.SUBMITTED
        : HomeworkSubmissionStatus.NOT_SUBMITTED;

  for (const [slot, studentId] of studentIds.entries()) {
    const existing = await repos.homeworkSubmissionRepository.findOne({
      where: { tenant_id: schoolId, assignment_id: assignment.id, student_id: studentId },
    });
    if (existing) continue;

    const status = statusForSlot(slot);
    await repos.homeworkSubmissionRepository.save(
      repos.homeworkSubmissionRepository.create({
        tenant_id: schoolId,
        assignment_id: assignment.id,
        student_id: studentId,
        status,
        marks: null,
        attachments: [],
      }),
    );
    result.submissions += 1;
  }

  const topicSeeds: readonly { name: string; sequence: number; status: SyllabusTopicStatus }[] = [
    { name: 'Introduction', sequence: 1, status: SyllabusTopicStatus.DONE },
    { name: 'Core Concepts', sequence: 2, status: SyllabusTopicStatus.DONE },
    { name: 'Advanced Problems', sequence: 3, status: SyllabusTopicStatus.PLANNED },
  ];
  for (const topicSeed of topicSeeds) {
    const existing = await repos.syllabusTopicRepository.findOne({
      where: {
        tenant_id: schoolId,
        class_id: classId,
        subject_id: subjectId,
        sequence: topicSeed.sequence,
      },
    });
    if (existing) continue;

    await repos.syllabusTopicRepository.save(
      repos.syllabusTopicRepository.create({
        tenant_id: schoolId,
        class_id: classId,
        subject_id: subjectId,
        name: topicSeed.name,
        description: null,
        sequence: topicSeed.sequence,
        status: topicSeed.status,
      }),
    );
    result.syllabusTopics += 1;
  }

  if (
    result.homework > 0 ||
    result.assignments > 0 ||
    result.submissions > 0 ||
    result.syllabusTopics > 0
  ) {
    console.log(
      `  Homework demo seed: +${result.homework} homework, +${result.assignments} assignments, ` +
        `+${result.submissions} submissions, +${result.syllabusTopics} syllabus topics`,
    );
  }
  return result;
}
