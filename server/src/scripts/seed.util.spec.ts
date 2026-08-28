import { UserRole, UserStatus } from '@biddaloy/shared';
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
import {
  DEMO_CLASSES,
  DEMO_STUDENTS_PER_SECTION,
  ensureDemoStudents,
  ensureRoleTestUsers,
  ensureSecondSchoolMembership,
  ROLE_TEST_USERS,
} from './seed.util';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../../../e2e/seed-contract';

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
