import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { TestingModule } from '@nestjs/testing';
import { UserStatus } from '@biddaloy/shared';
import { waitForLockWaiters } from '@test/helpers/db.helper';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../entities/platform-admin.entity';
import { PlatformAdminService } from '../platform-admin.service';
import { PlatformApprovalsService, hashPayload } from './platform-approvals.service';

const PAYLOAD = { method: 'POST', path: '/platform/owners/x/lock', body: { reason: 'r' } };
const SCOPE = 'platform.owner_lock';

let seq = 0;
const run = String(Math.floor(Math.random() * 1e5)).padStart(5, '0'); // users are never deleted: audit rows point at them

describe('PlatformApprovalsService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: PlatformApprovalsService;
  const deliver = vi.fn().mockResolvedValue({ logId: null, status: 'SENT' });
  let a: string; // requester
  let b: string; // the other owner

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      PlatformApprovalsService,
      PlatformAdminService,
      AuditService,
      { provide: AccountAccessDeliveryService, useValue: { deliver } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PlatformApprovalsService);
  });

  const makeOwner = async (tag: string, status = UserStatus.ACTIVE) => {
    const user = await ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `Owner ${tag}`,
        email: `${tag}-${run}-${++seq}@owners.test`,
        phone: `+88017${run}${String(seq).padStart(3, '0')}${tag === 'a' ? 1 : 2}`,
        status,
        password_hash: null,
      }),
    );
    await ds.getRepository(PlatformAdmin).save({ user_id: user.id } as never);
    return user.id;
  };

  const cleanup = async () => {
    await ds.query(`DELETE FROM platform_approvals`);
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

  it('the requester cannot approve their own request', async () => {
    const { id } = await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    await expect(svc.decide(id, a, 'approve')).rejects.toBeInstanceOf(ConflictException);
    await svc.decide(id, b, 'approve'); // the other owner can
  });

  it('two parallel consume calls held at the claim: exactly one wins', async () => {
    const { id } = await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    await svc.decide(id, b, 'approve');
    const hash = hashPayload(PAYLOAD);
    // Latch: another transaction holds the row, so both claims are waiting on it at once.
    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    try {
      await holder.query(`SELECT id FROM platform_approvals WHERE id = $1 FOR UPDATE`, [id]);
      const racers = [svc.consume(id, a, hash), svc.consume(id, a, hash)];
      racers.forEach((p) => p.catch(() => undefined));
      await waitForLockWaiters(ds, '%used_at = now()%', 2);
      await holder.commitTransaction();
      const results = await Promise.all(racers);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
    }
  });

  it('consume fails for a changed payload, another actor, or a request never approved', async () => {
    const { id } = await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    expect(await svc.consume(id, a, hashPayload(PAYLOAD))).toBe(false); // still PENDING
    await svc.decide(id, b, 'approve');
    expect(await svc.consume(id, a, hashPayload({ ...PAYLOAD, body: { reason: 'other' } }))).toBe(
      false,
    );
    expect(await svc.consume(id, b, hashPayload(PAYLOAD))).toBe(false);
    expect(await svc.consume(id, a, hashPayload(PAYLOAD))).toBe(true);
  });

  it('an expired row cannot be approved or used', async () => {
    const pending = await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    await ds.query(`UPDATE platform_approvals SET expires_at = now() - interval '1 minute'`);
    await expect(svc.decide(pending.id, b, 'approve')).rejects.toBeInstanceOf(ConflictException);

    const other = await svc.request(a, SCOPE, { ...PAYLOAD, path: '/other' }, { action: 'x' });
    await svc.decide(other.id, b, 'approve');
    await ds.query(`UPDATE platform_approvals SET expires_at = now() - interval '1 minute'`);
    expect(await svc.consume(other.id, a, hashPayload({ ...PAYLOAD, path: '/other' }))).toBe(false);
    const rows = await svc.list('EXPIRED');
    expect(rows.map((r) => r.id).sort()).toEqual([pending.id, other.id].sort());
  });

  it('the other owner gets one notice per channel, and a repeat of a live request sends no more', async () => {
    await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    const calls = deliver.mock.calls.map(([x]) => x);
    expect(calls).toHaveLength(2); // one SMS + one email, to B only
    expect(calls.map((c) => c.medium).sort()).toEqual(['EMAIL', 'SMS']);
    expect(calls.every((c) => c.to.includes('b-') || c.to.startsWith('+880'))).toBe(true);
    expect(calls.every((c) => c.vars.code === undefined)).toBe(true); // no secret in it
  });

  it('a locked owner cannot decide', async () => {
    const { id } = await svc.request(a, SCOPE, PAYLOAD, { action: 'lock' });
    await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [b]);
    await expect(svc.decide(id, b, 'approve')).rejects.toBeInstanceOf(ConflictException);
  });

  it('list is capped at 100 rows', async () => {
    expect((await svc.list(undefined, 5000)).length).toBeLessThanOrEqual(100);
  });
});
