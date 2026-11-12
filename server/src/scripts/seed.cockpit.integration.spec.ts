import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { authenticator } from 'otplib';
import { DEV_COCKPIT_TOTP_SECRET } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { MfaService } from '../modules/auth/mfa/mfa.service';
import { EncryptionService } from '../modules/schools/settings/encryption.service';
import { PlatformHomeService } from '../modules/platform-identity/platform-home.service';
import { DEV_COCKPIT_OWNER_EMAIL, ensureDevCockpitOwner } from './seed.util';

/** [98.6.1] The dev seed's cockpit step: owner row, confirmed MFA, platform school; twice = same. */
describe('ensureDevCockpitOwner (integration)', () => {
  let ds: DataSource;
  let mfa: MfaService;
  let home: PlatformHomeService;
  let userId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
    mfa = new MfaService(ds, new EncryptionService(randomBytes(32)));
    home = new PlatformHomeService(ds);
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    await ds.query(`DELETE FROM users WHERE email = $1`, [DEV_COCKPIT_OWNER_EMAIL]);
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (email, full_name, status) VALUES ($1, 'Dev owner', 'ACTIVE') RETURNING id`,
      [DEV_COCKPIT_OWNER_EMAIL],
    );
  }, 60000);

  afterAll(async () => {
    if (!ds) return;
    await ds.query(`DELETE FROM user_mfa WHERE user_id = $1`, [userId]);
    await ds.query(`DELETE FROM platform_admins WHERE user_id = $1`, [userId]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    await ds.query(`DELETE FROM schools WHERE slug = 'biddaloy-platform'`);
    await ds.destroy();
  });

  it('is idempotent and leaves a verifiable owner', async () => {
    await ensureDevCockpitOwner(ds, home, mfa, {});
    await ensureDevCockpitOwner(ds, home, mfa, {});

    const admins = await ds.query(`SELECT 1 FROM platform_admins WHERE user_id = $1`, [userId]);
    const confirmed = await ds.query(
      `SELECT 1 FROM user_mfa WHERE user_id = $1 AND confirmed_at IS NOT NULL`,
      [userId],
    );
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM schools WHERE is_platform`);
    expect([admins.length, confirmed.length, n]).toEqual([1, 1, 1]);
    expect(await mfa.verifyCode(userId, authenticator.generate(DEV_COCKPIT_TOTP_SECRET))).toBe(
      true,
    );
  });

  it('refuses the public dev secret on a non-local database unless a secret is set', async () => {
    const remote = Object.create(ds, {
      options: { value: { ...ds.options, url: 'postgres://u:p@db.example.com:5432/x' } },
    }) as DataSource;
    await expect(ensureDevCockpitOwner(remote, home, mfa, {})).rejects.toThrow(
      /non-local database/,
    );
  });

  it('uses COCKPIT_TEST_TOTP_SECRET when set', async () => {
    const secret = authenticator.generateSecret();
    await ensureDevCockpitOwner(ds, home, mfa, { COCKPIT_TEST_TOTP_SECRET: secret });
    expect(await mfa.verifyCode(userId, authenticator.generate(secret))).toBe(true);
  });
});
