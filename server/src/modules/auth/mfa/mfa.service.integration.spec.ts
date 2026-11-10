import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { MfaService } from './mfa.service';
import { EncryptionService } from '../../schools/settings/encryption.service';
import { User } from '../../users/entities/user.entity';

const NOW = 1_700_000_000_000;
const codeAt = (secret: string, ms: number) => authenticator.clone({ epoch: ms }).generate(secret);

describe('MfaService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: MfaService;
  let encryption: EncryptionService;
  let userId: string;
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, ENV_NAME: process.env.ENV_NAME };

  beforeAll(async () => {
    encryption = new EncryptionService(randomBytes(32));
    module = await createTestModule(ALL_ENTITIES, [
      MfaService,
      { provide: EncryptionService, useValue: encryption },
    ]);
    dataSource = module.get(DataSource);
    service = module.get(MfaService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        full_name: 'Mfa Tester',
        email: `mfa-${randomBytes(4).toString('hex')}@example.test`,
        status: UserStatus.ACTIVE,
        password_hash: null,
      }),
    );
    userId = user.id;
  });

  afterEach(async () => {
    // user_mfa and recovery codes cascade with the user.
    await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    if (savedEnv.ENV_NAME === undefined) delete process.env.ENV_NAME;
    else process.env.ENV_NAME = savedEnv.ENV_NAME;
  });

  async function enrol(): Promise<{ secret: string; codes: string[] }> {
    const { secret } = await service.beginEnrolment(userId, 'tester@example.test');
    const codes = await service.confirmEnrolment(userId, codeAt(secret, NOW), NOW);
    return { secret, codes };
  }

  it('stores the secret encrypted, never in plaintext', async () => {
    const { secret } = await service.beginEnrolment(userId, 'tester@example.test');
    const [row] = await dataSource.query('SELECT secret_enc FROM user_mfa WHERE user_id = $1', [
      userId,
    ]);
    expect(row.secret_enc).not.toContain(secret);
    expect(encryption.decrypt(row.secret_enc)).toBe(secret);
  });

  it('confirms enrolment and hands out ten recovery codes', async () => {
    const { codes } = await enrol();
    expect(codes).toHaveLength(10);
    expect(await service.status(userId)).toEqual({ enrolled: true, recoveryRemaining: 10 });
  });

  it('refuses to restart enrolment once confirmed', async () => {
    await enrol();
    await expect(service.beginEnrolment(userId, 'x')).rejects.toThrow(
      'Authenticator is already set up.',
    );
  });

  it('an unconfirmed secret cannot verify', async () => {
    const { secret } = await service.beginEnrolment(userId, 'tester@example.test');
    expect(await service.verifyCode(userId, codeAt(secret, NOW), NOW)).toBe(false);
    expect(await service.status(userId)).toEqual({ enrolled: false, recoveryRemaining: 0 });
  });

  it('rejects a wrong code at confirmation', async () => {
    await service.beginEnrolment(userId, 'tester@example.test');
    await expect(service.confirmEnrolment(userId, '000000', NOW)).rejects.toThrow(
      'Code is not valid.',
    );
  });

  it('the same code twice: the second is a replay and returns false', async () => {
    const { secret } = await enrol();
    const later = NOW + 30_000;
    const code = codeAt(secret, later);
    expect(await service.verifyCode(userId, code, later)).toBe(true);
    expect(await service.verifyCode(userId, code, later)).toBe(false);
    // The confirmation step is also spent: an older step never verifies again.
    expect(await service.verifyCode(userId, codeAt(secret, NOW), NOW)).toBe(false);
  });

  it('two parallel verifies of one code: exactly one wins', async () => {
    const { secret } = await enrol();
    const later = NOW + 60_000;
    const code = codeAt(secret, later);
    const results = await Promise.all([
      service.verifyCode(userId, code, later),
      service.verifyCode(userId, code, later),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a recovery code works once, in any case/spacing', async () => {
    const { codes } = await enrol();
    expect(await service.useRecoveryCode(userId, codes[0].toUpperCase())).toBe(true);
    expect(await service.useRecoveryCode(userId, codes[0])).toBe(false);
    expect((await service.status(userId)).recoveryRemaining).toBe(9);
  });

  it('two parallel useRecoveryCode calls on one code: exactly one true', async () => {
    const { codes } = await enrol();
    const results = await Promise.all([
      service.useRecoveryCode(userId, codes[1]),
      service.useRecoveryCode(userId, codes[1]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('regenerateRecoveryCodes invalidates the old set', async () => {
    const { codes: oldCodes } = await enrol();
    const fresh = await service.regenerateRecoveryCodes(userId);
    expect(fresh).toHaveLength(10);
    expect(await service.useRecoveryCode(userId, oldCodes[2])).toBe(false);
    expect(await service.useRecoveryCode(userId, fresh[0])).toBe(true);
  });

  it('regenerateRecoveryCodes needs a confirmed enrolment', async () => {
    await expect(service.regenerateRecoveryCodes(userId)).rejects.toThrow(
      'Authenticator is not set up.',
    );
  });

  it('reset deletes the MFA row and every recovery code', async () => {
    const { codes } = await enrol();
    await service.reset(userId);
    expect(await service.status(userId)).toEqual({ enrolled: false, recoveryRemaining: 0 });
    expect(await service.useRecoveryCode(userId, codes[0])).toBe(false);
  });

  it('enrolWithKnownSecret confirms enrolment with no recovery codes', async () => {
    process.env.NODE_ENV = 'test';
    const secret = authenticator.generateSecret();
    await service.enrolWithKnownSecret(userId, secret);
    expect(await service.status(userId)).toEqual({ enrolled: true, recoveryRemaining: 0 });
    expect(await service.verifyCode(userId, codeAt(secret, NOW), NOW)).toBe(true);
  });

  it('enrolWithKnownSecret throws in production unless ENV_NAME is staging', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENV_NAME = 'production';
    await expect(
      service.enrolWithKnownSecret(userId, authenticator.generateSecret()),
    ).rejects.toThrow();
    expect((await service.status(userId)).enrolled).toBe(false);

    process.env.ENV_NAME = 'staging';
    await service.enrolWithKnownSecret(userId, authenticator.generateSecret());
    expect((await service.status(userId)).enrolled).toBe(true);
  });
});
