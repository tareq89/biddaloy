import { AttendanceStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { School } from '../modules/schools/entities/school.entity';
import type { User } from '../modules/users/entities/user.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Class } from '../modules/academics/entities/class.entity';
import type { ClassSection } from '../modules/academics/entities/class-section.entity';
import type { Student } from '../modules/students/entities/student.entity';
import type { Guardian } from '../modules/students/entities/guardian.entity';
import type { Subject } from '../modules/academics/entities/subject.entity';
import type { SchoolHoliday } from '../modules/academics/entities/school-holiday.entity';
import type { Teacher } from '../modules/academics/entities/teacher.entity';
import type { TeacherClassSection } from '../modules/academics/entities/teacher-class-section.entity';
import type { AttendanceSession } from '../modules/attendance/entities/attendance-session.entity';
import type { AttendanceRecord } from '../modules/attendance/entities/attendance-record.entity';
import type { AttendanceDevice } from '../modules/attendance/entities/attendance-device.entity';
import { hashDeviceKey } from '../modules/attendance/devices/device.service';
import {
  ATTENDANCE_SEED_ABSENT_DATE,
  DEMO_CLASSES,
  DEMO_STUDENTS_PER_SECTION,
  ensureAttendanceSeed,
  ensureDemoStudents,
  ensureRoleTestUsers,
  ensureSecondSchoolMembership,
  ROLE_TEST_USERS,
  SEED_DEVICE_KEY,
} from './seed.util';
import {
  ATTENDANCE_SEED_ABSENT_DATE as E2E_ATTENDANCE_SEED_ABSENT_DATE,
  SEED_DEVICE_KEY as E2E_SEED_DEVICE_KEY,
  SEED_PASSWORD_ENV,
  SEED_ROLE_EMAILS,
} from '../../../e2e/seed-contract';

let nextId = 0;

/** `save`'s mock assigns an `id` the way a real insert would — the
 * production code reads `secondSchool.id` right after `save()` to build
 * the membership's `tenant_id`, so a mock that left it `undefined` would
 * make these tests pass for the wrong reason. */
function mockRepo<T extends { id?: string }>(): Repository<T> {
  return {
    findOne: vi.fn(),
    create: vi.fn((data: Partial<T>) => data as T),
    save: vi.fn((entity: T) => {
      entity.id ??= `generated-id-${(nextId += 1)}`;
      return Promise.resolve(entity);
    }),
  } as unknown as Repository<T>;
}

describe('ensureSecondSchoolMembership', () => {
  it('creates the second school and the membership when neither exists', async () => {
    const schoolRepository = mockRepo<School>();
    const userTenantRepository = mockRepo<UserTenant>();
    vi.mocked(schoolRepository.findOne).mockResolvedValue(null);
    vi.mocked(userTenantRepository.findOne).mockResolvedValue(null);

    await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, 'admin-1');

    // `toMatchObject`, not `toHaveBeenCalledWith` — `save`'s mock assigns
    // `id` onto this same object in place (matching real TypeORM
    // behavior), so by the time this assertion runs the captured call
    // argument already carries the `id` a plain equality check wouldn't
    // have been given at call time.
    expect(schoolRepository.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(schoolRepository.create).mock.calls[0]?.[0]).toMatchObject({
      name: 'Rose Valley School',
      slug: 'rose-valley-school',
    });
    expect(schoolRepository.save).toHaveBeenCalledTimes(1);
    const createdSchool = vi.mocked(schoolRepository.save).mock.calls[0]?.[0];
    expect(userTenantRepository.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(userTenantRepository.create).mock.calls[0]?.[0]).toMatchObject({
      user_id: 'admin-1',
      tenant_id: createdSchool?.id,
      role: UserRole.ADMIN,
    });
    expect(userTenantRepository.save).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing second school rather than creating a duplicate', async () => {
    const schoolRepository = mockRepo<School>();
    const userTenantRepository = mockRepo<UserTenant>();
    const existingSchool = { id: 'school-2', name: 'Rose Valley School' } as School;
    vi.mocked(schoolRepository.findOne).mockResolvedValue(existingSchool);
    vi.mocked(userTenantRepository.findOne).mockResolvedValue(null);

    await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, 'admin-1');

    expect(schoolRepository.create).not.toHaveBeenCalled();
    expect(schoolRepository.save).not.toHaveBeenCalled();
    expect(userTenantRepository.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(userTenantRepository.create).mock.calls[0]?.[0]).toMatchObject({
      user_id: 'admin-1',
      tenant_id: 'school-2',
      role: UserRole.ADMIN,
    });
    expect(userTenantRepository.save).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing membership rather than creating a duplicate', async () => {
    const schoolRepository = mockRepo<School>();
    const userTenantRepository = mockRepo<UserTenant>();
    const existingSchool = { id: 'school-2', name: 'Rose Valley School' } as School;
    const existingMembership = {
      user_id: 'admin-1',
      tenant_id: 'school-2',
      role: UserRole.ADMIN,
    } as UserTenant;
    vi.mocked(schoolRepository.findOne).mockResolvedValue(existingSchool);
    vi.mocked(userTenantRepository.findOne).mockResolvedValue(existingMembership);

    await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, 'admin-1');

    expect(userTenantRepository.create).not.toHaveBeenCalled();
    expect(userTenantRepository.save).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call with the now-existing records creates nothing further', async () => {
    const schoolRepository = mockRepo<School>();
    const userTenantRepository = mockRepo<UserTenant>();
    let savedSchool: School | undefined;
    let savedMembership: UserTenant | undefined;
    vi.mocked(schoolRepository.findOne).mockImplementation(() =>
      Promise.resolve(savedSchool ?? null),
    );
    vi.mocked(schoolRepository.save).mockImplementation((school) => {
      savedSchool = { id: 'school-2', ...school } as School;
      return Promise.resolve(savedSchool);
    });
    vi.mocked(userTenantRepository.findOne).mockImplementation(() =>
      Promise.resolve(savedMembership ?? null),
    );
    vi.mocked(userTenantRepository.save).mockImplementation((membership) => {
      savedMembership = membership as UserTenant;
      return Promise.resolve(savedMembership);
    });

    await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, 'admin-1');
    await ensureSecondSchoolMembership(schoolRepository, userTenantRepository, 'admin-1');

    expect(schoolRepository.save).toHaveBeenCalledTimes(1);
    expect(userTenantRepository.save).toHaveBeenCalledTimes(1);
  });
});

describe('ensureRoleTestUsers', () => {
  it('creates a user and a membership for every entry in ROLE_TEST_USERS', async () => {
    const userRepository = mockRepo<User>();
    const userTenantRepository = mockRepo<UserTenant>();
    vi.mocked(userRepository.findOne).mockResolvedValue(null);
    vi.mocked(userTenantRepository.findOne).mockResolvedValue(null);

    await ensureRoleTestUsers(userRepository, userTenantRepository, 'school-1', 'hashed-pw');

    expect(userRepository.create).toHaveBeenCalledTimes(ROLE_TEST_USERS.length);
    expect(userTenantRepository.create).toHaveBeenCalledTimes(ROLE_TEST_USERS.length);
    for (const [index, { email, role, fullName }] of ROLE_TEST_USERS.entries()) {
      expect(vi.mocked(userRepository.create).mock.calls[index]?.[0]).toMatchObject({
        email,
        password_hash: 'hashed-pw',
        status: UserStatus.ACTIVE,
        full_name: fullName,
      });
      // `create`'s mock returns the same object `save` later mutates an
      // `id` onto in place (see `mockRepo`'s own comment above) — reading
      // it back from `create`'s call args, not `save`'s promise-wrapped
      // return value, gets the post-mutation object.
      const createdUser = vi.mocked(userRepository.create).mock.calls[index]?.[0] as
        User | undefined;
      expect(vi.mocked(userTenantRepository.create).mock.calls[index]?.[0]).toMatchObject({
        tenant_id: 'school-1',
        user_id: createdUser?.id,
        role,
      });
    }
  });

  it('reuses an existing, non-deleted user and membership rather than creating duplicates', async () => {
    const userRepository = mockRepo<User>();
    const userTenantRepository = mockRepo<UserTenant>();
    const existingUser = { id: 'user-1', deleted_at: null } as User;
    vi.mocked(userRepository.findOne).mockResolvedValue(existingUser);
    // Membership already holds the configured role for whichever
    // ROLE_TEST_USERS entry is currently being processed, so nothing
    // needs to change — a role mismatch is covered separately below.
    let findOneCallCount = 0;
    vi.mocked(userTenantRepository.findOne).mockImplementation(() => {
      const role = ROLE_TEST_USERS[findOneCallCount]!.role;
      findOneCallCount += 1;
      return Promise.resolve({ user_id: 'user-1', tenant_id: 'school-1', role });
    });

    await ensureRoleTestUsers(userRepository, userTenantRepository, 'school-1', 'hashed-pw');

    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(userTenantRepository.create).not.toHaveBeenCalled();
    expect(userTenantRepository.save).not.toHaveBeenCalled();
  });

  it('restores a soft-deleted user with a fresh password rather than erroring', async () => {
    const userRepository = mockRepo<User>();
    const userTenantRepository = mockRepo<UserTenant>();
    // A fresh object per call — six distinct emails in `ROLE_TEST_USERS`
    // means six distinct rows in reality; reusing one shared mutable
    // object here would have the loop's own restore-mutation on role 1
    // (`deleted_at = null`) leak into every later role's `findOne` result.
    let findOneCallCount = 0;
    vi.mocked(userRepository.findOne).mockImplementation(() => {
      findOneCallCount += 1;
      return Promise.resolve({
        id: `deleted-user-${findOneCallCount}`,
        deleted_at: new Date('2025-01-01'),
        password_hash: 'stale-hash',
        status: UserStatus.SUSPENDED,
      } as User);
    });
    vi.mocked(userTenantRepository.findOne).mockResolvedValue(null);

    await ensureRoleTestUsers(userRepository, userTenantRepository, 'school-1', 'fresh-hash');

    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).toHaveBeenCalledTimes(ROLE_TEST_USERS.length);
    const [savedUser] = vi.mocked(userRepository.save).mock.calls[0] ?? [];
    expect(savedUser).toMatchObject({
      password_hash: 'fresh-hash',
      status: UserStatus.ACTIVE,
      deleted_at: null,
    });
  });

  it('reconciles an existing membership whose role no longer matches the configured seed role', async () => {
    const userRepository = mockRepo<User>();
    const userTenantRepository = mockRepo<UserTenant>();
    vi.mocked(userRepository.findOne).mockResolvedValue({ id: 'user-1', deleted_at: null } as User);

    // A stale role from before ROLE_TEST_USERS was reconfigured, or a role
    // an operator manually changed in the DB — the seed should still
    // report the configured role as the source of truth on every run. Each
    // entry gets the *next* entry's role (guaranteed to differ, since all
    // six roles in ROLE_TEST_USERS are distinct), rather than one shared
    // mutable object whose "wrongness" would depend on save() mutating it
    // in place between loop iterations.
    let findOneCallCount = 0;
    vi.mocked(userTenantRepository.findOne).mockImplementation(() => {
      const wrongRole = ROLE_TEST_USERS[(findOneCallCount + 1) % ROLE_TEST_USERS.length]!.role;
      findOneCallCount += 1;
      return Promise.resolve({ user_id: 'user-1', tenant_id: 'school-1', role: wrongRole });
    });

    await ensureRoleTestUsers(userRepository, userTenantRepository, 'school-1', 'hashed-pw');

    expect(userTenantRepository.create).not.toHaveBeenCalled();
    expect(userTenantRepository.save).toHaveBeenCalledTimes(ROLE_TEST_USERS.length);
    for (const [index, { role }] of ROLE_TEST_USERS.entries()) {
      expect(vi.mocked(userTenantRepository.save).mock.calls[index]?.[0]).toMatchObject({
        role,
      });
    }
  });
});

// [8.5.2] drift guard: the E2E suite's credentials live in
// `e2e/seed-contract.ts` and must always describe exactly what this seed
// creates. The server suite imports the e2e contract (never the reverse)
// so a mismatch fails here, next to the code being changed.
describe('e2e seed contract', () => {
  it('matches ROLE_TEST_USERS exactly — one entry per role, same emails', () => {
    const expected = Object.fromEntries(
      ROLE_TEST_USERS.map(({ role, email }) => [role.toLowerCase(), email]),
    );
    expect(SEED_ROLE_EMAILS).toEqual(expected);
  });

  it('names the same password env var the seed script requires', () => {
    // seed.ts reads process.env.SEED_ADMIN_PASSWORD; the contract must
    // point E2E fixtures at the same variable.
    expect(SEED_PASSWORD_ENV).toBe('SEED_ADMIN_PASSWORD');
  });

  it('[9.11] matches the literal device key seed.util.ts hashes and stores', () => {
    expect(E2E_SEED_DEVICE_KEY).toBe(SEED_DEVICE_KEY);
  });

  it('[9.11] matches the literal absent date seed.util.ts actually seeds for roll 1', () => {
    expect(E2E_ATTENDANCE_SEED_ABSENT_DATE).toBe(ATTENDANCE_SEED_ABSENT_DATE);
  });
});

describe('ensureDemoStudents', () => {
  function demoRepos() {
    return {
      academicYearRepository: mockRepo<AcademicYear>(),
      classRepository: mockRepo<Class>(),
      classSectionRepository: mockRepo<ClassSection>(),
      studentRepository: mockRepo<Student>(),
      guardianRepository: mockRepo<Guardian>(),
    };
  }

  /** Every findOne returns null — the "empty database" path. */
  function emptyDatabase(repos: ReturnType<typeof demoRepos>) {
    for (const repo of Object.values(repos)) {
      vi.mocked(repo.findOne).mockResolvedValue(null);
    }
  }

  const EXPECTED_SECTIONS = DEMO_CLASSES.reduce((n, c) => n + c.sections.length, 0);
  const EXPECTED_STUDENTS = EXPECTED_SECTIONS * DEMO_STUDENTS_PER_SECTION;

  it('creates the whole academic chain and a multi-section roster', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);

    const result = await ensureDemoStudents(repos, 'school-1');

    expect(result).toEqual({
      classes: DEMO_CLASSES.length,
      sections: EXPECTED_SECTIONS,
      students: EXPECTED_STUDENTS,
      guardians: 5,
    });
    // More than one degenerate row, and spread over sections rather than
    // all piled into one — this is what makes the list route's pagination
    // and class column render something real (#356).
    expect(EXPECTED_STUDENTS).toBeGreaterThan(1);
    expect(EXPECTED_SECTIONS).toBeGreaterThan(1);
    expect(repos.academicYearRepository.create).toHaveBeenCalledTimes(1);
    expect(repos.classRepository.create).toHaveBeenCalledTimes(DEMO_CLASSES.length);
    expect(repos.classSectionRepository.create).toHaveBeenCalledTimes(EXPECTED_SECTIONS);
    expect(repos.studentRepository.create).toHaveBeenCalledTimes(EXPECTED_STUDENTS);
  });

  it('scopes every created row to the given tenant', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);

    await ensureDemoStudents(repos, 'school-1');

    for (const repo of Object.values(repos)) {
      const calls = vi.mocked(repo.create).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const [payload] of calls) {
        expect(payload).toMatchObject({ tenant_id: 'school-1' });
      }
    }
  });

  it('gives every student a section, a unique registration number and a guardian', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);

    await ensureDemoStudents(repos, 'school-1');

    const students = vi
      .mocked(repos.studentRepository.create)
      .mock.calls.map(([payload]) => payload as Partial<Student>);
    expect(new Set(students.map((s) => s.registration_number)).size).toBe(EXPECTED_STUDENTS);
    for (const student of students) {
      expect(student.class_section_id).toBeTruthy();
      expect(student.full_name).toBeTruthy();
      expect(student.guardians).toHaveLength(1);
    }
    // Roll numbers restart per section rather than running 1..N globally —
    // the (class_section_id, roll_number) unique index is what they have to
    // satisfy, and a global sequence would look wrong on the detail page.
    expect(students.map((s) => s.roll_number)).toContain(1);
    expect(Math.max(...students.map((s) => s.roll_number as number))).toBe(
      DEMO_STUDENTS_PER_SECTION,
    );
  });

  it('is idempotent: a second run against a seeded database creates nothing', async () => {
    const repos = demoRepos();
    vi.mocked(repos.academicYearRepository.findOne).mockResolvedValue({
      id: 'year-1',
      deleted_at: null,
    } as AcademicYear);
    vi.mocked(repos.classRepository.findOne).mockResolvedValue({
      id: 'class-1',
      deleted_at: null,
    } as Class);
    vi.mocked(repos.classSectionRepository.findOne).mockResolvedValue({
      id: 'section-1',
      deleted_at: null,
    } as ClassSection);
    vi.mocked(repos.studentRepository.findOne).mockResolvedValue({
      id: 'student-1',
      deleted_at: null,
    } as Student);
    vi.mocked(repos.guardianRepository.findOne).mockResolvedValue({
      id: 'guardian-1',
      deleted_at: null,
      user_id: null,
    } as Guardian);

    const result = await ensureDemoStudents(repos, 'school-1');

    expect(result).toEqual({ classes: 0, sections: 0, students: 0, guardians: 0 });
    for (const repo of Object.values(repos)) {
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    }
  });

  it('restores a soft-deleted student instead of inserting a duplicate', async () => {
    // The students unique index has no `WHERE deleted_at IS NULL`, so the
    // soft-deleted row still owns its registration number — inserting again
    // would be a constraint violation, not a duplicate.
    const repos = demoRepos();
    emptyDatabase(repos);
    const deleted = { id: 'student-1', deleted_at: new Date() } as Student;
    vi.mocked(repos.studentRepository.findOne).mockResolvedValue(deleted);

    const result = await ensureDemoStudents(repos, 'school-1');

    expect(result.students).toBe(0);
    expect(repos.studentRepository.create).not.toHaveBeenCalled();
    expect(deleted.deleted_at).toBeNull();
    expect(repos.studentRepository.save).toHaveBeenCalledWith(deleted);
  });

  // #356 review: `academic_years(name, tenant_id)` and
  // `class_sections(class_id, section_name)` are *partial* unique indexes
  // (`WHERE "deleted_at" IS NULL`), unlike students/classes. A soft-deleted
  // row is therefore allowed to sit alongside a live one with the same key,
  // so a plain `withDeleted: true` lookup could return the dead row and
  // undeleting it would violate the index against the live one.
  it('prefers a live academic year over a soft-deleted namesake', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const live = { id: 'year-live', deleted_at: null } as AcademicYear;
    const softDeleted = { id: 'year-dead', deleted_at: new Date() } as AcademicYear;
    vi.mocked(repos.academicYearRepository.findOne).mockImplementation(
      (options?: { withDeleted?: boolean }) =>
        Promise.resolve(options?.withDeleted === true ? softDeleted : live),
    );

    await ensureDemoStudents(repos, 'school-1');

    // The dead row is left dead, and the live row is not resurrected-and-saved.
    expect(softDeleted.deleted_at).not.toBeNull();
    expect(repos.academicYearRepository.save).not.toHaveBeenCalledWith(softDeleted);
    expect(repos.academicYearRepository.create).not.toHaveBeenCalled();
    // Classes hang off the live year, not the deleted one.
    expect(vi.mocked(repos.classRepository.create).mock.calls[0]?.[0]).toMatchObject({
      academic_year_id: 'year-live',
    });
  });

  it('still restores a soft-deleted academic year when no live one exists', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const softDeleted = { id: 'year-dead', deleted_at: new Date() } as AcademicYear;
    vi.mocked(repos.academicYearRepository.findOne).mockImplementation(
      (options?: { withDeleted?: boolean }) =>
        Promise.resolve(options?.withDeleted === true ? softDeleted : null),
    );

    await ensureDemoStudents(repos, 'school-1');

    expect(softDeleted.deleted_at).toBeNull();
    expect(repos.academicYearRepository.save).toHaveBeenCalledWith(softDeleted);
    expect(repos.academicYearRepository.create).not.toHaveBeenCalled();
  });

  it('prefers a live class section over a soft-deleted namesake', async () => {
    // Same partial-index reasoning as the academic year above.
    const repos = demoRepos();
    emptyDatabase(repos);
    const live = { id: 'section-live', deleted_at: null } as ClassSection;
    const softDeleted = { id: 'section-dead', deleted_at: new Date() } as ClassSection;
    vi.mocked(repos.classSectionRepository.findOne).mockImplementation(
      (options?: { withDeleted?: boolean }) =>
        Promise.resolve(options?.withDeleted === true ? softDeleted : live),
    );

    await ensureDemoStudents(repos, 'school-1');

    expect(softDeleted.deleted_at).not.toBeNull();
    expect(repos.classSectionRepository.save).not.toHaveBeenCalled();
    expect(vi.mocked(repos.studentRepository.create).mock.calls[0]?.[0]).toMatchObject({
      class_section_id: 'section-live',
    });
  });

  it('claims is_current only when the tenant has no current academic year', async () => {
    const withCurrent = demoRepos();
    emptyDatabase(withCurrent);
    // Keyed on the `where` clause rather than call order: the year lookup
    // makes more than one `findOne` call (live row first, then a
    // `withDeleted` fallback — see `findLivePreferred`), so a
    // `mockResolvedValueOnce` chain would silently answer the wrong query.
    vi.mocked(withCurrent.academicYearRepository.findOne).mockImplementation(
      (options?: { where?: { is_current?: boolean } }) =>
        Promise.resolve(
          options?.where?.is_current === true ? ({ id: 'other-year' } as AcademicYear) : null,
        ),
    );
    await ensureDemoStudents(withCurrent, 'school-1');
    expect(vi.mocked(withCurrent.academicYearRepository.create).mock.calls[0]?.[0]).toMatchObject({
      is_current: false,
    });

    const without = demoRepos();
    emptyDatabase(without);
    await ensureDemoStudents(without, 'school-1');
    expect(vi.mocked(without.academicYearRepository.create).mock.calls[0]?.[0]).toMatchObject({
      is_current: true,
    });
  });

  // #345 review, finding 1: `academic_years` carries a *second* partial unique
  // index on `(is_current, tenant_id) WHERE is_current = true AND deleted_at IS
  // NULL`. Restoring a dead year that was current, while another year has since
  // been crowned by hand, would violate it and abort the entire seed.
  it('drops is_current when restoring a dead year and another year is already current', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const softDeleted = {
      id: 'year-dead',
      deleted_at: new Date(),
      is_current: true,
    } as AcademicYear;
    vi.mocked(repos.academicYearRepository.findOne).mockImplementation(
      (options?: { withDeleted?: boolean; where?: { is_current?: boolean } }) => {
        // Someone else already owns the `is_current` slot.
        if (options?.where?.is_current === true) {
          return Promise.resolve({ id: 'other-year' } as AcademicYear);
        }
        return Promise.resolve(options?.withDeleted === true ? softDeleted : null);
      },
    );

    await ensureDemoStudents(repos, 'school-1');

    expect(softDeleted.deleted_at).toBeNull();
    expect(softDeleted.is_current).toBe(false);
    expect(repos.academicYearRepository.save).toHaveBeenCalledWith(softDeleted);
  });

  it('keeps is_current when restoring a dead year and no other year is current', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const softDeleted = {
      id: 'year-dead',
      deleted_at: new Date(),
      is_current: true,
    } as AcademicYear;
    vi.mocked(repos.academicYearRepository.findOne).mockImplementation(
      (options?: { withDeleted?: boolean }) =>
        Promise.resolve(options?.withDeleted === true ? softDeleted : null),
    );

    await ensureDemoStudents(repos, 'school-1');

    expect(softDeleted.deleted_at).toBeNull();
    expect(softDeleted.is_current).toBe(true);
  });

  // #345 review, finding 2: `students(class_section_id, roll_number)` is a
  // plain unique index. A hand-made roster in the same section owns rolls 1..3
  // under different registration numbers, so the registration-number check
  // cannot see it and a blind `roll_number: 1` insert aborts the seed.
  it('skips roll numbers already taken in the section', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const TAKEN = new Set([1, 2, 3]);
    vi.mocked(repos.studentRepository.findOne).mockImplementation(
      (options?: { where?: { roll_number?: number } }) => {
        const roll = options?.where?.roll_number;
        // Registration-number lookups have no `roll_number`: nothing seeded yet.
        if (roll === undefined) return Promise.resolve(null);
        return Promise.resolve(
          TAKEN.has(roll) ? ({ id: `pre-existing-${roll}` } as Student) : null,
        );
      },
    );

    await ensureDemoStudents(repos, 'school-1');

    const rolls = vi
      .mocked(repos.studentRepository.create)
      .mock.calls.map(([payload]) => (payload as Partial<Student>).roll_number);
    // Every seeded student lands past the hand-made 1..3 block.
    expect(rolls.every((roll) => (roll as number) > 3)).toBe(true);
    expect(rolls).toHaveLength(EXPECTED_STUDENTS);
  });

  it('gives each student in a section a distinct roll number', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);

    await ensureDemoStudents(repos, 'school-1');

    const bySection = new Map<string, number[]>();
    for (const [payload] of vi.mocked(repos.studentRepository.create).mock.calls) {
      const student = payload as Partial<Student>;
      const key = String(student.class_section_id);
      bySection.set(key, [...(bySection.get(key) ?? []), student.roll_number as number]);
    }
    for (const rolls of bySection.values()) {
      expect(new Set(rolls).size).toBe(rolls.length);
    }
  });

  it('links only the first guardian to the portal account', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);

    await ensureDemoStudents(repos, 'school-1', 'parent-user-1');

    const guardians = vi
      .mocked(repos.guardianRepository.create)
      .mock.calls.map(([payload]) => payload as Partial<Guardian>);
    expect(guardians[0]?.user_id).toBe('parent-user-1');
    expect(guardians.slice(1).every((g) => g.user_id === null)).toBe(true);
  });

  it('re-links the portal guardian when an older seed left it unlinked', async () => {
    const repos = demoRepos();
    emptyDatabase(repos);
    const existing = { id: 'guardian-1', deleted_at: null, user_id: null } as Guardian;
    vi.mocked(repos.guardianRepository.findOne).mockResolvedValueOnce(existing);

    await ensureDemoStudents(repos, 'school-1', 'parent-user-1');

    expect(existing.user_id).toBe('parent-user-1');
    expect(repos.guardianRepository.save).toHaveBeenCalledWith(existing);
  });
});

describe('ensureAttendanceSeed', () => {
  function attendanceRepos() {
    return {
      subjectRepository: mockRepo<Subject>(),
      schoolHolidayRepository: mockRepo<SchoolHoliday>(),
      teacherRepository: mockRepo<Teacher>(),
      teacherClassSectionRepository: mockRepo<TeacherClassSection>(),
      attendanceSessionRepository: mockRepo<AttendanceSession>(),
      attendanceRecordRepository: mockRepo<AttendanceRecord>(),
      attendanceDeviceRepository: mockRepo<AttendanceDevice>(),
    };
  }

  function emptyDatabase(repos: ReturnType<typeof attendanceRepos>) {
    for (const repo of Object.values(repos)) {
      vi.mocked(repo.findOne).mockResolvedValue(null);
    }
  }

  const STUDENT_IDS = ['student-1', 'student-2', 'student-3'];
  const BASE_PARAMS = {
    schoolId: 'school-1',
    academicYearId: 'year-1',
    sectionId: 'section-1',
    studentIds: STUDENT_IDS,
    teacherUserId: 'teacher-user-1',
  };

  it('creates 5 subjects, 3 holidays, the teacher mapping, one session/record set per working day of the seeded month, and 2 devices', async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);

    const result = await ensureAttendanceSeed(repos, BASE_PARAMS);

    // 26 working days in ATTENDANCE_SEED_MONTH (31 days − 4 Fridays − 1
    // non-working holiday) × 3 students.
    expect(result).toEqual({ subjects: 5, holidays: 3, sessions: 26, records: 78, devices: 2 });
  });

  it('is idempotent: a second run against an already-seeded database creates nothing further', async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);
    await ensureAttendanceSeed(repos, BASE_PARAMS);

    // Re-run against a "already exists" world: every findOne now resolves
    // to a stored row rather than null.
    vi.mocked(repos.subjectRepository.findOne).mockResolvedValue({ deleted_at: null } as Subject);
    vi.mocked(repos.schoolHolidayRepository.findOne).mockResolvedValue({
      deleted_at: null,
    } as SchoolHoliday);
    vi.mocked(repos.teacherRepository.findOne).mockResolvedValue({
      id: 'teacher-1',
      deleted_at: null,
    } as Teacher);
    vi.mocked(repos.teacherClassSectionRepository.findOne).mockResolvedValue(
      {} as TeacherClassSection,
    );
    vi.mocked(repos.attendanceSessionRepository.findOne).mockResolvedValue({
      id: 'session-1',
    } as AttendanceSession);
    vi.mocked(repos.attendanceRecordRepository.findOne).mockResolvedValue({} as AttendanceRecord);
    vi.mocked(repos.attendanceDeviceRepository.findOne).mockResolvedValue({} as AttendanceDevice);

    const second = await ensureAttendanceSeed(repos, BASE_PARAMS);

    expect(second).toEqual({ subjects: 0, holidays: 0, sessions: 0, records: 0, devices: 0 });
  });

  it('gives exactly one of the three seeded students a record set that would compute below 75%', async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);

    await ensureAttendanceSeed(repos, BASE_PARAMS);

    const records = vi
      .mocked(repos.attendanceRecordRepository.create)
      .mock.calls.map(([payload]) => payload as Partial<AttendanceRecord>);
    const byStudent = new Map<string, Partial<AttendanceRecord>[]>();
    for (const record of records) {
      const key = record.student_id as string;
      byStudent.set(key, [...(byStudent.get(key) ?? []), record]);
    }

    // student-3's ~9 PRESENT / 26 working days is the only one under the
    // default 75% threshold — present-day count alone is enough to prove
    // this without re-implementing the percentage formula.
    const WORKING_DAYS = 26;
    const presentCounts = STUDENT_IDS.map(
      (id) => (byStudent.get(id) ?? []).filter((r) => r.status === AttendanceStatus.PRESENT).length,
    );
    const belowThreshold = presentCounts.filter((present) => present / WORKING_DAYS < 0.75);
    expect(belowThreshold).toHaveLength(1);
    expect(presentCounts[2]).toBe(9);
  });

  it('gives every status to at least one student across the roster', async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);

    await ensureAttendanceSeed(repos, BASE_PARAMS);

    const statuses = new Set(
      vi
        .mocked(repos.attendanceRecordRepository.create)
        .mock.calls.map(([payload]) => (payload as Partial<AttendanceRecord>).status),
    );
    expect(statuses).toEqual(
      new Set([
        AttendanceStatus.PRESENT,
        AttendanceStatus.ABSENT,
        AttendanceStatus.LATE,
        AttendanceStatus.LEAVE,
      ]),
    );
  });

  it('maps teacher@biddaloy.test to the seeded section via teacher_class_sections', async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);

    await ensureAttendanceSeed(repos, BASE_PARAMS);

    // The exact id `save()` assigned the newly-created teacher — asserted
    // by identity, not a hardcoded literal, so this test would fail if a
    // future change mapped the section to some *other* teacher's id.
    const createdTeacher = vi.mocked(repos.teacherRepository.create).mock.calls[0]?.[0] as {
      id?: string;
    };
    expect(repos.teacherClassSectionRepository.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repos.teacherClassSectionRepository.create).mock.calls[0]?.[0]).toMatchObject({
      teacher_id: createdTeacher.id,
      section_id: 'section-1',
      subject_id: null,
    });
  });

  it("stores the ACTIVE device's key as the SHA-256 hash of SEED_DEVICE_KEY, matching the e2e contract", async () => {
    const repos = attendanceRepos();
    emptyDatabase(repos);

    await ensureAttendanceSeed(repos, BASE_PARAMS);

    const devices = vi
      .mocked(repos.attendanceDeviceRepository.create)
      .mock.calls.map(([payload]) => payload as Partial<AttendanceDevice>);
    const active = devices.find((d) => d.status === 'ACTIVE');
    expect(active?.token_hash).toBe(hashDeviceKey(SEED_DEVICE_KEY));
    expect(SEED_DEVICE_KEY).toBe(E2E_SEED_DEVICE_KEY);
  });

  it('produces the same (date, student, status) rows across two runs on an empty database (determinism)', async () => {
    // Compares the deterministic fields only — `id`/`session_id` come from
    // this mock's own shared, ever-incrementing counter (`mockRepo`'s
    // `nextId`), not from `ensureAttendanceSeed`, so they legitimately
    // differ between two separate calls in this test even though a real
    // Postgres run (verified manually against a real database, twice)
    // writes the identical set of rows both times.
    const runOnce = async () => {
      const repos = attendanceRepos();
      emptyDatabase(repos);
      await ensureAttendanceSeed(repos, BASE_PARAMS);
      return vi.mocked(repos.attendanceRecordRepository.create).mock.calls.map(([payload]) => {
        const record = payload as Partial<AttendanceRecord>;
        return {
          date: record.date,
          student_id: record.student_id,
          status: record.status,
          minutes_late: record.minutes_late,
        };
      });
    };

    const first = await runOnce();
    const second = await runOnce();
    expect(second).toEqual(first);
  });
});
