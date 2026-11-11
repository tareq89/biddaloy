import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PlatformCutoverService, CUTOVER_DONE_KEY } from './platform-cutover.service';

describe('PlatformCutoverService (integration)', () => {
  let ds: DataSource;
  const tag = `cut${process.pid}`;
  let oldPlatform: string;
  let schoolB: string;
  const audit = { record: vi.fn() };
  const cutOff = vi.fn();
  let failAudit = false;

  const make = () =>
    new PlatformCutoverService(
      ds,
      { platformTenantId: async () => oldPlatform } as never,
      { cutOff } as never,
      {
        record: async (...a: unknown[]) => {
          if (failAudit) throw new Error('boom');
          return audit.record(...a);
        },
      } as never,
    );

  const mkUser = async (name: string): Promise<string> => {
    const [u] = await ds.query(
      `INSERT INTO users (email, full_name, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [`${tag}-${name}@cut.test`, name],
    );
    return u.id;
  };
  const join = (userId: string, tenant: string, role: UserRole) =>
    ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1,$2,$3)`, [
      userId,
      tenant,
      role,
    ]);
  const live = (userId: string): Promise<{ tenant_id: string; role: string }[]> =>
    ds.query(`SELECT tenant_id, role FROM user_tenants WHERE user_id = $1 AND deleted_at IS NULL`, [
      userId,
    ]);
  const done = async () =>
    (await ds.query(`SELECT 1 FROM platform_settings WHERE key = $1`, [CUTOVER_DONE_KEY])).length;

  const cleanup = async () => {
    await ds.query(`DELETE FROM platform_settings WHERE key = $1`, [CUTOVER_DONE_KEY]);
    await ds.query(`DELETE FROM platform_admins`);
    await ds.query(
      `DELETE FROM user_tenants WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${tag}%`],
    );
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}%`]);
    await ds.query(`DELETE FROM schools WHERE slug LIKE $1`, [`${tag}%`]);
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  });
  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    failAudit = false;
    const [a] = await ds.query(
      `INSERT INTO schools (slug, name) VALUES ($1, 'Old platform') RETURNING id`,
      [`${tag}-old`],
    );
    const [b] = await ds.query(
      `INSERT INTO schools (slug, name) VALUES ($1, 'School B') RETURNING id`,
      [`${tag}-b`],
    );
    oldPlatform = a.id;
    schoolB = b.id;
  });
  afterAll(cleanup);

  it('an owner loses the old platform membership and stays an owner', async () => {
    const owner = await mkUser('owner');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    await join(owner, oldPlatform, UserRole.SUPER_ADMIN);

    await make().run();

    expect(await live(owner)).toEqual([]);
    expect(
      await ds.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [owner]),
    ).toHaveLength(1);
    expect(cutOff).toHaveBeenCalledWith(owner, expect.anything(), expect.any(Date));
  });

  it('a non-owner SUPER_ADMIN of the platform school loses it and their sessions end', async () => {
    const owner = await mkUser('owner');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    const sa = await mkUser('sa');
    await join(sa, oldPlatform, UserRole.SUPER_ADMIN);

    await make().run();

    expect(await live(sa)).toEqual([]);
    expect(cutOff.mock.calls.map((c) => c[0])).toContain(sa);
    // The membership removal is audited against the old platform school, actor null.
    const entries = audit.record.mock.calls.map((c) => c[0]);
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'DELETE',
        tenant_id: oldPlatform,
        performed_by_user_id: null,
      }),
    );
  });

  it('a legacy SUPER_ADMIN of another school becomes ADMIN; a duplicate ADMIN row is removed', async () => {
    const owner = await mkUser('owner');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    const plain = await mkUser('plain');
    await join(plain, schoolB, UserRole.SUPER_ADMIN);
    const dup = await mkUser('dup');
    await join(dup, schoolB, UserRole.SUPER_ADMIN);
    await join(dup, schoolB, UserRole.ADMIN);

    await make().run();

    expect(await live(plain)).toEqual([{ tenant_id: schoolB, role: 'ADMIN' }]);
    expect(await live(dup)).toEqual([{ tenant_id: schoolB, role: 'ADMIN' }]);
    // Never deletes a user.
    expect(await ds.query(`SELECT 1 FROM users WHERE id = ANY($1)`, [[plain, dup]])).toHaveLength(
      2,
    );
  });

  it('a second run changes nothing', async () => {
    const owner = await mkUser('owner');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    const sa = await mkUser('sa');
    await join(sa, schoolB, UserRole.SUPER_ADMIN);

    expect(await make().run()).not.toBeNull();
    audit.record.mockClear();
    cutOff.mockClear();
    expect(await make().run()).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
    expect(cutOff).not.toHaveBeenCalled();
  });

  it('a fresh database (no owners) is skipped and cutover.done stays unset', async () => {
    const sa = await mkUser('sa');
    await join(sa, schoolB, UserRole.SUPER_ADMIN);
    expect(await make().run()).toBeNull();
    expect(await live(sa)).toEqual([{ tenant_id: schoolB, role: 'SUPER_ADMIN' }]);
    expect(await done()).toBe(0);
  });

  it('a failure midway rolls everything back and leaves cutover.done unset', async () => {
    const owner = await mkUser('owner');
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [owner]);
    const sa = await mkUser('sa');
    await join(sa, schoolB, UserRole.SUPER_ADMIN);
    failAudit = true;

    await expect(make().run()).rejects.toThrow('boom');

    expect(await live(sa)).toEqual([{ tenant_id: schoolB, role: 'SUPER_ADMIN' }]);
    expect(await done()).toBe(0);
  });
});
