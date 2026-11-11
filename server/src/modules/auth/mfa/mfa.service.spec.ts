import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import type { DataSource } from 'typeorm';
import { EncryptionService } from '../../schools/settings/encryption.service';
import { MfaService } from './mfa.service';

function make(rows: unknown[] = []) {
  const query = vi.fn(async () => rows);
  const service = new MfaService(
    { query, transaction: vi.fn() } as unknown as DataSource,
    new EncryptionService(randomBytes(32)),
  );
  return { service, query };
}

describe('MfaService (unit)', () => {
  const env = { NODE_ENV: process.env.NODE_ENV, ENV_NAME: process.env.ENV_NAME };
  afterEach(() => {
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.ENV_NAME === undefined) delete process.env.ENV_NAME;
    else process.env.ENV_NAME = env.ENV_NAME;
  });

  it('verifyCode is false and writes nothing when the user has no MFA row', async () => {
    const { service, query } = make([]);
    expect(await service.verifyCode('u', '123456')).toBe(false);
    expect(query).toHaveBeenCalledTimes(1); // only the SELECT
  });

  it('status of a user with no row is not enrolled', async () => {
    const { service } = make([]);
    expect(await service.status('u')).toEqual({ enrolled: false, recoveryRemaining: 0 });
  });

  it('enrolWithKnownSecret is refused in production, and nothing is written', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENV_NAME = 'production';
    const { service, query } = make();
    await expect(service.enrolWithKnownSecret('u', 'JBSWY3DPEHPK3PXP')).rejects.toThrow(
      'Not available in this environment.',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
