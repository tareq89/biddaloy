import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { AuthTokenPurpose, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuthTokenService } from './auth-token.service';
import { User } from '../users/entities/user.entity';

describe('AuthTokenService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: AuthTokenService;
  let userId: string;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [AuthTokenService]);
    dataSource = module.get(DataSource);
    service = module.get(AuthTokenService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM auth_tokens');
    await dataSource.query('DELETE FROM users');
    await dataSource.query(
      `INSERT INTO schools (id, name, slug) VALUES ($1, 'Test School', 'test-school-auth-token') ON CONFLICT (id) DO NOTHING`,
      [SEED_TENANT_ID],
    );
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        full_name: 'Invitee',
        email: 'invitee@example.com',
        status: UserStatus.ACTIVE,
      }),
    );
    userId = user.id;
  });

  it('stores a hash that is not the raw token', async () => {
    const { raw, row } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });
    expect(row.token_hash).not.toEqual(raw);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verify distinguishes valid / expired / consumed / revoked / unknown', async () => {
    const { raw } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });

    expect(await service.verify('not-a-real-token', AuthTokenPurpose.INVITE)).toEqual({
      status: 'unknown',
    });

    const valid = await service.verify(raw, AuthTokenPurpose.INVITE);
    expect(valid.status).toBe('valid');
    if (valid.status !== 'valid') throw new Error('unreachable');

    await service.consume(valid.row.id);
    expect(await service.verify(raw, AuthTokenPurpose.INVITE)).toEqual({ status: 'consumed' });

    const { raw: rawExpired } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.PASSWORD_RESET,
      ttlMs: -1_000, // already expired
    });
    expect(await service.verify(rawExpired, AuthTokenPurpose.PASSWORD_RESET)).toEqual({
      status: 'expired',
    });

    const { raw: rawRevoked } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.EMAIL_VERIFY,
      ttlMs: 60_000,
    });
    await service.revokeLive(userId, AuthTokenPurpose.EMAIL_VERIFY);
    expect(await service.verify(rawRevoked, AuthTokenPurpose.EMAIL_VERIFY)).toEqual({
      status: 'revoked',
    });
  });

  it('a second issue revokes the first (resend AC)', async () => {
    const { raw: firstRaw } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });
    await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });

    expect(await service.verify(firstRaw, AuthTokenPurpose.INVITE)).toEqual({ status: 'revoked' });
  });

  it('consuming an already-consumed row throws 409', async () => {
    const { row } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });
    await service.consume(row.id);
    await expect(service.consume(row.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('only one token stays live when two issue() calls race for the same (user, purpose)', async () => {
    const [first, second] = await Promise.all([
      service.issue({
        userId,
        tenantId: SEED_TENANT_ID,
        purpose: AuthTokenPurpose.INVITE,
        ttlMs: 60_000,
      }),
      service.issue({
        userId,
        tenantId: SEED_TENANT_ID,
        purpose: AuthTokenPurpose.INVITE,
        ttlMs: 60_000,
      }),
    ]);

    const results = await Promise.all([
      service.verify(first.raw, AuthTokenPurpose.INVITE),
      service.verify(second.raw, AuthTokenPurpose.INVITE),
    ]);
    const liveCount = results.filter((r) => r.status === 'valid').length;
    expect(liveCount).toBe(1);
  });

  it('only one of two concurrent consume() calls on the same row succeeds', async () => {
    const { row } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });

    const results = await Promise.allSettled([service.consume(row.id), service.consume(row.id)]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof ConflictException,
    ).length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
  });

  it('latest returns the newest row for a (user, purpose)', async () => {
    await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });
    const { row: second } = await service.issue({
      userId,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: 60_000,
    });

    const latest = await service.latest(userId, AuthTokenPurpose.INVITE);
    expect(latest?.id).toBe(second.id);
  });
});
