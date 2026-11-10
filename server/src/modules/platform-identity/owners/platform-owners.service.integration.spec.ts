import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TestingModule } from '@nestjs/testing';
import { AuditAction, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { MfaService } from '../../auth/mfa/mfa.service';
import { REFRESH_TOKEN_TTL_MS, RefreshTokenService } from '../../auth/refresh-token.service';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { SessionCutoffService } from '../../auth/session-cutoff.service';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../entities/platform-admin.entity';
import { PlatformOwnersService } from './platform-owners.service';

let seq = 0;
const run = String(Math.floor(Math.random() * 1e5)).padStart(5, '0'); // users are never deleted: audit rows point at them

describe('PlatformOwnersService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: PlatformOwnersService;
  let refresh: RefreshTokenService;
  const deliver = vi.fn().mockResolvedValue({ logId: null, status: 'SENT' });
  let a: string;
  let b: string;
  const ctx = { ip: '127.0.0.1', userAgent: 'vitest' };

  beforeAll(async () => {
    module = await createTestModule(
      [...ALL_ENTITIES, RefreshToken],
      [
        PlatformOwnersService,
        SessionCutoffService,
        RefreshTokenService,
        AuditService,
        { provide: REFRESH_TOKEN_TTL_MS, useValue: 3_600_000 },
        { provide: MfaService, useValue: { status: async () => ({ enrolled: true }) } },
        { provide: AccountAccessDeliveryService, useValue: { deliver } },
      ],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PlatformOwnersService);
    refresh = module.get(RefreshTokenService);
  });

  const makeOwner = async (tag: string) => {
    const repo = ds.getRepository(User);
    const user = await repo.save(
      repo.create({
        full_name: `Owner ${tag}`,
        email: `${tag}-${run}-${++seq}@owners.test`,
        phone: `+88018${run}${String(seq).padStart(3, '0')}${tag === 'a' ? 1 : 2}`,
        status: UserStatus.ACTIVE,
        password_hash: null,
      }),
    );
    await ds.getRepository(PlatformAdmin).save({ user_id: user.id } as never);
    return user.id;
  };

  const cleanup = async () => {
    await ds.query(
      `DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@owners.test')`,
    );
    await ds.query(`DELETE FROM platform_admins`);
  };

  beforeEach(async () => {
    await cleanup();
    deliver.mockClear();
    a = await makeOwner('a');
    b = await makeOwner('b');
  });
  afterAll(async () => {
    await cleanup();
    await module.close();
  });

  const status = async (id: string) =>
    (await ds.query(`SELECT status, tokens_valid_after FROM users WHERE id = $1`, [id]))[0];

  it('lock suspends the owner, cuts access tokens and revokes refresh tokens; the other keeps working', async () => {
    await refresh.issueForUser(b, randomUUID(), ctx);
    await svc.lock(a, b);

    const locked = await status(b);
    expect(locked.status).toBe('SUSPENDED');
    expect(locked.tokens_valid_after).not.toBeNull(); // Rule 8: old access tokens die next request
    const live = await ds.query(
      `SELECT count(*)::int n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [b],
    );
    expect(live[0].n).toBe(0);
    expect((await status(a)).status).toBe('ACTIVE');

    const owners = await svc.list();
    const row = owners.find((o) => o.userId === b)!;
    expect(row.status).toBe('LOCKED');
    expect(row.lockedByName).toBe('Owner a');
    expect(row.email).toMatch(/•••/);
  });

  it('refuses a self-lock with 409 CANNOT_LOCK_SELF', async () => {
    await expect(svc.lock(a, a)).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'CANNOT_LOCK_SELF' } },
    });
  });

  it('refuses to lock the last active owner with 409 LAST_OWNER', async () => {
    await svc.lock(a, b);
    // b is locked, so a is the only active owner; a third party cannot lock a. b locking a is
    // refused too, because no OTHER active owner would remain.
    await expect(svc.lock(b, a)).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'LAST_OWNER' } },
    });
    expect((await status(a)).status).toBe('ACTIVE');
  });

  it('two owners locking each other at once: exactly one lock lands', async () => {
    const results = await Promise.allSettled([svc.lock(a, b), svc.lock(b, a)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = await ds.query(
      `SELECT count(*)::int n FROM users u JOIN platform_admins pa ON pa.user_id = u.id WHERE u.status = 'ACTIVE'`,
    );
    expect(active[0].n).toBe(1);
  });

  it('unlock restores the owner and clears the lock record', async () => {
    await svc.lock(a, b);
    await svc.unlock(a, b);
    expect((await status(b)).status).toBe('ACTIVE');
    const row = (await svc.list()).find((o) => o.userId === b)!;
    expect(row.status).toBe('ACTIVE');
    expect(row.lockedAt).toBeNull();
    await expect(svc.unlock(a, b)).rejects.toMatchObject({ status: 409 }); // not locked now
  });

  it('a non-owner target is a 404', async () => {
    await expect(svc.lock(a, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('history shows platform rows with fixed labels and never a contact, code or snapshot', async () => {
    const audit = module.get(AuditService);
    await audit.record({
      action: AuditAction.PLATFORM_LOGIN,
      entity_type: 'PlatformAdmin',
      entity_id: a,
      tenant_id: null,
      performed_by_user_id: a,
      ip_address: '9.9.9.9',
      new_values: { email: 'secret@owners.test', code: '123456' },
    });
    await svc.lock(a, b);
    const page = await svc.history();
    expect(page.data.map((r) => r.label)).toEqual(
      expect.arrayContaining(['Signed in', 'Owner locked']),
    );
    const text = JSON.stringify(page);
    expect(text).not.toContain('secret@owners.test');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('9.9.9.9');
    const login = (await svc.list()).find((o) => o.userId === a)!;
    expect(login.lastLoginAt).not.toBeNull();
  });

  it('history pages by cursor without repeats', async () => {
    const audit = module.get(AuditService);
    for (let i = 0; i < 3; i++) {
      await audit.record({
        action: AuditAction.PLATFORM_LOGIN,
        entity_type: 'PlatformAdmin',
        entity_id: a,
        tenant_id: null,
        performed_by_user_id: a,
      });
    }
    const first = await svc.history(undefined, 2);
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await svc.history(first.nextCursor!, 2);
    const ids = [...first.data, ...second.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    await expect(svc.history('!!!')).rejects.toMatchObject({ status: 400 });
  });
});
