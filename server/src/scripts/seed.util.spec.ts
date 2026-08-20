import { UserRole } from '@biddaloy/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { School } from '../modules/schools/entities/school.entity';
import type { UserTenant } from '../modules/auth/entities/user-tenant.entity';
import { ensureSecondSchoolMembership } from './seed.util';

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
