import { UserStatus } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import type { Repository } from 'typeorm';
import type { School } from '../modules/schools/entities/school.entity';
import type { User } from '../modules/users/entities/user.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import type { AcademicYear } from '../modules/academics/entities/academic-year.entity';
import type { Class } from '../modules/academics/entities/class.entity';
import type { ClassSection } from '../modules/academics/entities/class-section.entity';
import type { Student } from '../modules/students/entities/student.entity';
import type { Guardian } from '../modules/students/entities/guardian.entity';
import { seedAccounts, type SeedAccountRepositories } from './seed.accounts';

/**
 * A deliberately small in-memory stand-in for a TypeORM repository. It only
 * models the two behaviours this spec depends on:
 *
 *  1. `findOne` matches on shallow equality of the `where` keys, and hides
 *     soft-deleted rows unless `withDeleted` is set.
 *  2. `save` stamps `created_at` from a monotonically increasing clock, the
 *     way a real INSERT would — that stamp is the whole point of the test,
 *     because "earliest membership wins" is decided by it.
 */
class FakeRepo<T extends Record<string, unknown>> {
  readonly rows: T[] = [];
  constructor(
    private readonly clock: { tick: () => Date },
    private readonly prefix: string,
  ) {}
  private nextId = 0;

  findOne(options: { where: Record<string, unknown>; withDeleted?: boolean }): Promise<T | null> {
    const found = this.rows.find(
      (row) =>
        Object.entries(options.where).every(([key, value]) => row[key] === value) &&
        (options.withDeleted === true || row.deleted_at == null),
    );
    return Promise.resolve(found ?? null);
  }

  create(data: Partial<T>): T {
    return { deleted_at: null, ...data } as T;
  }

  save(entity: T): Promise<T> {
    if (entity.id === undefined) {
      this.nextId += 1;
      (entity as Record<string, unknown>).id = `${this.prefix}-${this.nextId}`;
    }
    if (entity.created_at === undefined) {
      (entity as Record<string, unknown>).created_at = this.clock.tick();
    }
    if (!this.rows.includes(entity)) this.rows.push(entity);
    return Promise.resolve(entity);
  }

  asRepository(): Repository<T> {
    return this as unknown as Repository<T>;
  }
}

function makeRepos() {
  let now = 0;
  const clock = { tick: () => new Date(1_800_000_000_000 + (now += 1000)) };
  const users = new FakeRepo<Record<string, unknown>>(clock, 'user');
  const schools = new FakeRepo<Record<string, unknown>>(clock, 'school');
  const userTenants = new FakeRepo<Record<string, unknown>>(clock, 'membership');
  const students = new FakeRepo<Record<string, unknown>>(clock, 'student');
  const repos = {
    userRepository: users.asRepository() as unknown as Repository<User>,
    schoolRepository: schools.asRepository() as unknown as Repository<School>,
    userTenantRepository: userTenants.asRepository() as unknown as Repository<UserTenant>,
    academicYearRepository: new FakeRepo<Record<string, unknown>>(
      clock,
      'year',
    ).asRepository() as unknown as Repository<AcademicYear>,
    classRepository: new FakeRepo<Record<string, unknown>>(
      clock,
      'class',
    ).asRepository() as unknown as Repository<Class>,
    classSectionRepository: new FakeRepo<Record<string, unknown>>(
      clock,
      'section',
    ).asRepository() as unknown as Repository<ClassSection>,
    studentRepository: students.asRepository() as unknown as Repository<Student>,
    guardianRepository: new FakeRepo<Record<string, unknown>>(
      clock,
      'guardian',
    ).asRepository() as unknown as Repository<Guardian>,
  } satisfies SeedAccountRepositories;
  return { repos, users, schools, userTenants, students };
}

const DEFAULT_SCHOOL = { id: 'school-default', name: 'Default School', slug: 'default-school' };

/**
 * The same "earliest membership wins" rule AuthService applies
 * (`EARLIEST_MEMBERSHIP_ORDER`: `created_at ASC, id ASC`). Duplicated here
 * on purpose — the point of the test is that the *seed's call order*, not
 * the query, is what puts the right school first.
 */
function earliestFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const byTime = (a.created_at as Date).getTime() - (b.created_at as Date).getTime();
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  });
}

describe('seedAccounts', () => {
  it("puts the default school first among the ADMIN test user's memberships", async () => {
    // #356: `scripts/lighthouse-student-url.mjs` logs in as
    // admin@biddaloy.test and queries `memberships[0]` for a student id.
    // Demo students exist only at the default school, so if the second
    // school's membership were created first the script would query an
    // empty tenant, print nothing, and fail the Lighthouse CI job. This
    // invariant is created purely by the order of the calls inside
    // `seedAccounts` — swap them and this test goes red.
    const { repos, users, userTenants, students } = makeRepos();

    await seedAccounts(repos, DEFAULT_SCHOOL as unknown as School, 'admin@school.com', 'hash');

    const adminTestUser = users.rows.find((u) => u.email === 'admin@biddaloy.test');
    expect(adminTestUser).toBeDefined();
    const memberships = earliestFirst(
      userTenants.rows.filter((m) => m.user_id === adminTestUser?.id),
    );
    // More than one membership, or the ordering below proves nothing.
    expect(memberships.length).toBeGreaterThan(1);
    expect(memberships[0]?.tenant_id).toBe(DEFAULT_SCHOOL.id);
  });

  it('seeds every demo student into that same first-membership school', async () => {
    // The other half of the invariant: memberships[0] is only useful to the
    // Lighthouse script because the roster lives in that exact tenant.
    const { repos, students } = makeRepos();

    await seedAccounts(repos, DEFAULT_SCHOOL as unknown as School, 'admin@school.com', 'hash');

    expect(students.rows.length).toBeGreaterThan(0);
    expect(students.rows.every((s) => s.tenant_id === DEFAULT_SCHOOL.id)).toBe(true);
  });

  it('gives the SUPER_ADMIN the default school as its earliest membership too', async () => {
    const { repos, users, userTenants } = makeRepos();

    await seedAccounts(repos, DEFAULT_SCHOOL as unknown as School, 'admin@school.com', 'hash');

    const superAdmin = users.rows.find((u) => u.email === 'admin@school.com');
    const memberships = earliestFirst(userTenants.rows.filter((m) => m.user_id === superAdmin?.id));
    expect(memberships[0]?.tenant_id).toBe(DEFAULT_SCHOOL.id);
  });

  it('restores a soft-deleted SUPER_ADMIN with the freshly supplied credentials', async () => {
    const { repos, users } = makeRepos();
    // Pre-existing row, as if an operator had soft-deleted the account
    // before this run — same prior state (SUSPENDED, a stale hash) the
    // sibling `ensureRoleTestUsers` restoration test in seed.util.spec.ts
    // uses, since it's the same self-healing shape.
    users.rows.push({
      id: 'user-existing',
      email: 'admin@school.com',
      password_hash: 'stale-hash',
      status: UserStatus.SUSPENDED,
      deleted_at: new Date('2025-01-01'),
      created_at: new Date('2024-01-01'),
    });

    // A standard lookup must not see the account before seeding runs —
    // proves the pre-existing row really is excluded like any other
    // soft-deleted user, not just present with a `deleted_at` field that
    // happens to be ignored.
    const before = await repos.userRepository.findOne({ where: { email: 'admin@school.com' } });
    expect(before).toBeNull();

    await seedAccounts(
      repos,
      DEFAULT_SCHOOL as unknown as School,
      'admin@school.com',
      'fresh-hash',
    );

    const restored = users.rows.find((u) => u.email === 'admin@school.com');
    expect(restored).toMatchObject({
      deleted_at: null,
      status: UserStatus.ACTIVE,
      password_hash: 'fresh-hash',
    });
  });
});
