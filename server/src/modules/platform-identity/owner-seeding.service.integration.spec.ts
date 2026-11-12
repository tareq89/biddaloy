import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { OwnerSeedingService } from './owner-seeding.service';
import { PlatformHomeService } from './platform-home.service';
import { hashPassword, verifyPassword } from '../auth/password-hash';

describe('OwnerSeedingService (integration)', () => {
  let ds: DataSource;
  let home: PlatformHomeService;
  const tag = `own${process.pid}`;
  const e1 = `${tag}-1@owners.test`;
  const e2 = `${tag}-2@owners.test`;
  const p1 = '01711000001';
  const p2 = '01711000002';
  const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    COCKPIT_OWNER_1_EMAIL: e1.toUpperCase(), // mixed case on purpose: lookup is lower-cased
    COCKPIT_OWNER_1_PHONE: p1,
    COCKPIT_OWNER_2_EMAIL: e2,
    COCKPIT_OWNER_2_PHONE: p2,
    ...over,
  });
  const enrol = vi.fn();
  const make = () =>
    new OwnerSeedingService(
      ds,
      home,
      { platformTenantId: async () => undefined } as never,
      { enrolWithKnownSecret: enrol } as never,
    );

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    home = new PlatformHomeService(ds, { configuredPlatformTenantId: () => undefined } as never);
  });

  const cleanup = async () => {
    await ds.query(`DELETE FROM platform_admins`);
    await ds.query(
      `DELETE FROM user_tenants WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${tag}%`],
    );
    await ds.query(
      `DELETE FROM users WHERE email LIKE $1 OR phone IN ($2, $3, '+8801711000001', '+8801711000002')`,
      [`${tag}%`, p1, p2],
    );
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    await ds.query(`DELETE FROM schools WHERE slug = 'biddaloy-platform'`);
  };
  beforeEach(async () => {
    await cleanup();
    home = new PlatformHomeService(ds, { configuredPlatformTenantId: () => undefined } as never);
    vi.restoreAllMocks();
    enrol.mockReset();
  });
  afterAll(cleanup);

  const owners = () =>
    ds.query(
      `SELECT u.email, u.status, u.password_hash, u.email_verified_at, u.phone_verified_at
         FROM platform_admins pa JOIN users u ON u.id = pa.user_id ORDER BY u.email`,
    );
  const homes = () => ds.query(`SELECT id FROM schools WHERE is_platform`);

  it('a fresh database gets two owners and a platform home', async () => {
    await make().seed(env());
    const rows = await owners();
    expect(rows.map((r: { email: string }) => r.email)).toEqual([e1, e2]);
    for (const r of rows) {
      expect(r.status).toBe('ACTIVE');
      expect(r.password_hash).toBeNull();
      expect(r.email_verified_at).not.toBeNull();
      expect(r.phone_verified_at).not.toBeNull();
    }
    expect(await homes()).toHaveLength(1);
  });

  it('a second boot changes nothing', async () => {
    await make().seed(env());
    const before = await owners();
    await make().seed(env());
    expect(await owners()).toEqual(before);
    expect(await homes()).toHaveLength(1);
  });

  it('two concurrent boots create exactly two owners', async () => {
    await Promise.all([make().seed(env()), make().seed(env())]);
    expect(await owners()).toHaveLength(2);
    expect(await homes()).toHaveLength(1);
  });

  it('a changed secret email creates no third admin and warns once, slot only', async () => {
    await make().seed(env());
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await make().seed(
      env({
        COCKPIT_OWNER_2_EMAIL: `${tag}-new@owners.test`,
        COCKPIT_OWNER_2_PHONE: '01711000009',
      }),
    );
    expect(await owners()).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('COCKPIT_OWNER_2');
    expect(line).toContain('cockpit-replace-owner');
    expect(line).not.toContain('owners.test');
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}-new%`]);
  });

  it('stops boot with a slot-only message when an owner email is a school member', async () => {
    const [u] = await ds.query(
      `INSERT INTO users (email, full_name, status) VALUES ($1, 'School Admin', 'ACTIVE') RETURNING id`,
      [e1],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      u.id,
      SEED_TENANT_ID,
      UserRole.ADMIN,
    ]);
    const err = await make()
      .seed(env())
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect((err as Error).message).not.toContain('owners.test');
    expect(await owners()).toHaveLength(0);
  });

  it('stops boot with a slot-only message when another user already holds the owner phone', async () => {
    await ds.query(
      `INSERT INTO users (email, phone, full_name, status) VALUES ($1, $2, 'Other', 'ACTIVE')`,
      [`${tag}-other@owners.test`, '+8801711000001'],
    );
    const err = await make()
      .seed(env())
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect((err as Error).message).not.toContain('01711');
    expect((err as Error).message).not.toContain('owners.test');
    expect(await owners()).toHaveLength(0);
  });

  it('stops boot the same way when the owner email belongs to a soft-deleted user', async () => {
    await ds.query(
      `INSERT INTO users (email, full_name, status, deleted_at) VALUES ($1, 'Gone', 'ACTIVE', now())`,
      [e1],
    );
    const err = await make()
      .seed(env())
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect((err as Error).message).not.toContain('owners.test');
  });

  it('stops boot when the existing user with an owner email is not ACTIVE', async () => {
    await ds.query(
      `INSERT INTO users (email, full_name, status) VALUES ($1, 'Away', 'SUSPENDED')`,
      [e1],
    );
    const err = await make()
      .seed(env())
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('COCKPIT_OWNER_1');
    expect(await owners()).toHaveLength(0);
  });

  it('DEMO_MODE=true creates nothing', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    try {
      await make().seed(env());
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await owners()).toHaveLength(0);
    expect(await homes()).toHaveLength(0);
  });

  it('no log line carries an email or a phone', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => {
        lines.push(String(msg));
      });
    }
    await make().seed(env());
    await make().seed(
      env({ COCKPIT_OWNER_2_EMAIL: `${tag}-x@owners.test`, COCKPIT_OWNER_2_PHONE: '01711000008' }),
    );
    const all = lines.join('\n');
    expect(all).not.toContain('owners.test');
    expect(all).not.toContain('01711');
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}-x%`]);
  });

  describe('staging smoke owner (D16, D17)', () => {
    const SMOKE = {
      SMOKE_COCKPIT_EMAIL: e1,
      SMOKE_COCKPIT_PASSWORD: 'Smoke-pass-12345-x',
      SMOKE_COCKPIT_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    };
    const ownerRow = async () =>
      (await ds.query(`SELECT id, password_hash FROM users WHERE email = $1`, [e1]))[0];
    const devices = (id: string) =>
      ds.query(`SELECT 1 FROM platform_admin_devices WHERE user_id = $1`, [id]);

    it('seeds the password, the authenticator secret and a remembered device', async () => {
      await make().seed(env({ ENV_NAME: 'staging', ...SMOKE }));
      const row = await ownerRow();
      expect(await verifyPassword(SMOKE.SMOKE_COCKPIT_PASSWORD, row.password_hash)).toBe(true);
      expect(enrol).toHaveBeenCalledWith(row.id, SMOKE.SMOKE_COCKPIT_TOTP_SECRET);
      expect(await devices(row.id)).toHaveLength(1);
      // a second boot keeps one device row and the same hash
      await make().seed(env({ ENV_NAME: 'staging', ...SMOKE }));
      expect(await devices(row.id)).toHaveLength(1);
      expect((await ownerRow()).password_hash).toBe(row.password_hash);
    });

    it('production with the same variables changes nothing', async () => {
      await make().seed(env({ ENV_NAME: 'production', ...SMOKE }));
      const row = await ownerRow();
      expect(row.password_hash).toBeNull();
      expect(enrol).not.toHaveBeenCalled();
      expect(await devices(row.id)).toHaveLength(0);
    });

    it('dev (no ENV_NAME) with the same variables changes nothing', async () => {
      await make().seed(env({ ...SMOKE }));
      const row = await ownerRow();
      expect(row.password_hash).toBeNull();
      expect(enrol).not.toHaveBeenCalled();
      expect(await devices(row.id)).toHaveLength(0);
    });

    it('replaces the scrub-assigned staging hash with the smoke password', async () => {
      const staging = await hashPassword('shared-staging-pass');
      await ds.query(`UPDATE users SET password_hash = $2 WHERE email = $1`, [e1, staging]);
      await make().seed(env({ ENV_NAME: 'staging', ...SMOKE }));
      const row = await ownerRow();
      expect(await verifyPassword(SMOKE.SMOKE_COCKPIT_PASSWORD, row.password_hash)).toBe(true);
    });

    it('skips an email that is not an owner', async () => {
      await make().seed(
        env({ ENV_NAME: 'staging', ...SMOKE, SMOKE_COCKPIT_EMAIL: `${tag}-nobody@owners.test` }),
      );
      expect(enrol).not.toHaveBeenCalled();
    });
  });
});
