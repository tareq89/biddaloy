import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  ensurePlatformAdmin,
  validateInput,
  type PlatformAdminInput,
} from './create-platform-admin';
import { verifyPassword } from '../modules/auth/password-hash';

const PASSWORD = 'correct-horse-battery';

describe('create-platform-admin (integration)', () => {
  let ds: DataSource;
  // The seeded test school stands in for the platform school.
  const tenantId = SEED_TENANT_ID;
  const email = (tag: string) => `platform-admin-${tag}-${process.pid}@example.com`;
  const input = (tag: string): PlatformAdminInput => ({
    tenantId,
    email: email(tag),
    fullName: 'Platform Owner',
    password: PASSWORD,
  });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [
      `platform-admin-%-${process.pid}@example.com`,
    ]);
  });

  const memberships = (userEmail: string) =>
    ds.query(
      `SELECT ut.role FROM user_tenants ut JOIN users u ON u.id = ut.user_id
        WHERE u.email = $1 AND ut.tenant_id = $2 ORDER BY ut.role`,
      [userEmail, tenantId],
    );

  it('refuses bad input before touching the database', () => {
    expect(validateInput({ ...input('x'), tenantId: 'not-a-uuid' })).toMatch(/PLATFORM_TENANT_ID/);
    expect(validateInput({ ...input('x'), email: 'nope' })).toMatch(/usage/);
    expect(validateInput({ ...input('x'), password: 'short' })).toMatch(/12 to 72 bytes/);
    expect(validateInput(input('x'))).toBeNull();
  });

  it('creates an active, verified user with a SUPER_ADMIN membership of the platform school', async () => {
    expect(await ensurePlatformAdmin(ds, input('new'))).toBe('created');
    const [user] = await ds.query(
      `SELECT password_hash, status, email_verified_at FROM users WHERE email = $1`,
      [email('new')],
    );
    expect(user.status).toBe('ACTIVE');
    expect(user.email_verified_at).not.toBeNull();
    // The app's own check must accept the stored hash (Rule 9).
    expect(await verifyPassword(PASSWORD, user.password_hash)).toBe(true);
    expect(await memberships(email('new'))).toEqual([{ role: UserRole.SUPER_ADMIN }]);
  });

  it('is safe to re-run and never changes an existing password', async () => {
    const [before] = await ds.query(`SELECT password_hash FROM users WHERE email = $1`, [
      email('new'),
    ]);
    expect(
      await ensurePlatformAdmin(ds, { ...input('new'), password: 'a-different-password' }),
    ).toBe('already-admin');
    const [after] = await ds.query(`SELECT password_hash FROM users WHERE email = $1`, [
      email('new'),
    ]);
    expect(after.password_hash).toBe(before.password_hash);
    expect(await memberships(email('new'))).toEqual([{ role: UserRole.SUPER_ADMIN }]);
  });

  it('adds SUPER_ADMIN to an existing member and keeps their other role', async () => {
    await ensurePlatformAdmin(ds, input('teacher'));
    await ds.query(
      `DELETE FROM user_tenants WHERE tenant_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
      [tenantId, email('teacher')],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role)
       SELECT id, $1, 'TEACHER' FROM users WHERE email = $2`,
      [tenantId, email('teacher')],
    );
    expect(await ensurePlatformAdmin(ds, input('teacher'))).toBe('membership-added');
    expect(await memberships(email('teacher'))).toEqual([
      { role: UserRole.SUPER_ADMIN },
      { role: UserRole.TEACHER },
    ]);
  });

  it('fails when PLATFORM_TENANT_ID is not a school', async () => {
    await expect(
      ensurePlatformAdmin(ds, {
        ...input('ghost'),
        tenantId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow(/does not match any school/);
  });
});
