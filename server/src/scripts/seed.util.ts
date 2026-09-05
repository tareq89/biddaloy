import {
  AttendanceDeviceKind,
  AttendanceDeviceStatus,
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  TeacherDesignation,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
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
import { SchoolHoliday } from '../modules/academics/entities/school-holiday.entity';
import { Teacher } from '../modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../modules/academics/entities/teacher-class-section.entity';
import { AttendanceSession } from '../modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../modules/attendance/entities/attendance-device.entity';
import { hashDeviceKey } from '../modules/attendance/devices/device.service';

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

export interface DemoClassSeed {
  name: string;
  numericGrade: number;
  sections: readonly string[];
}

export const DEMO_CLASSES: readonly DemoClassSeed[] = [
  { name: 'Class 6', numericGrade: 6, sections: ['A', 'B'] },
  { name: 'Class 7', numericGrade: 7, sections: ['A', 'B'] },
  { name: 'Class 8', numericGrade: 8, sections: ['A'] },
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
  let rosterIndex = 0;
  for (const classSeed of DEMO_CLASSES) {
    let klass = await classRepository.findOne({
      where: { name: classSeed.name, academic_year_id: year.id, tenant_id: schoolId },
      withDeleted: true,
    });
    if (!klass) {
      klass = classRepository.create({
        name: classSeed.name,
        numeric_grade: classSeed.numericGrade,
        academic_year_id: year.id,
        tenant_id: schoolId,
      });
      await classRepository.save(klass);
      result.classes += 1;
    } else if (klass.deleted_at) {
      await classRepository.save(undelete(klass));
    }

    for (const sectionName of classSeed.sections) {
      let section = await findLivePreferred(classSectionRepository, {
        class_id: klass.id,
        section_name: sectionName,
        tenant_id: schoolId,
      });
      if (!section) {
        section = classSectionRepository.create({
          class_id: klass.id,
          section_name: sectionName,
          capacity: 30,
          tenant_id: schoolId,
        });
        await classSectionRepository.save(section);
        result.sections += 1;
      } else if (section.deleted_at) {
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
  schoolHolidayRepository: Repository<SchoolHoliday>;
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
        }),
      );
      result.holidays += 1;
    } else if (existing.deleted_at) {
      await repos.schoolHolidayRepository.save(undelete(existing));
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
