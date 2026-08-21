import { UserRole, UserStatus } from '@biddaloy/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { School } from '../modules/schools/entities/school.entity';
import type { User } from '../modules/users/entities/user.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { ensureRoleTestUsers, ensureSecondSchoolMembership, ROLE_TEST_USERS } from './seed.util';

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
