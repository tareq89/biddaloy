import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AuditAction, SupportAccessMode, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { SupportAccessNoticeService } from '../notices/support-access-notice.service';
import { IMPERSONATION_REDIS, impKey } from '../sessions/impersonation-redis';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { SupportRequestsService } from './support-requests.service';
import { SupportRequestListStatus } from './dto/support-requests.dto';

describe('SupportRequestsService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: SupportRequestsService;
  let redis: Redis;
  const ticketReady = vi.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    module = await createTestModule(ALL_ENTITIES, [
      SupportRequestsService,
      ImpersonationSessionService,
      AuditService,
      { provide: IMPERSONATION_REDIS, useValue: redis },
      {
        provide: SchoolSettingsReader,
        useValue: { supportAccessFresh: async () => ({ mode: SupportAccessMode.ALLOWED }) },
      },
      { provide: SupportAccessNoticeService, useValue: { ticketReady } },
    ]);
    ds = module.get(DataSource);
    svc = module.get(SupportRequestsService);
  }, 60000);

  afterAll(async () => {
    redis?.disconnect();
    await module?.close();
  });

  const mkUser = (n: string) =>
    ds.getRepository(User).save(
      ds.getRepository(User).create({
        full_name: `${n} ${randomUUID().slice(0, 6)}`,
        status: UserStatus.ACTIVE,
      }),
    );

  async function world() {
    const sfx = randomUUID().slice(0, 8);
    const school = await ds
      .getRepository(School)
      .save(ds.getRepository(School).create({ name: `S ${sfx}`, slug: `s-${sfx}` }));
    const owner = await mkUser('Owner');
    await ds.getRepository(PlatformAdmin).save({ user_id: owner.id });
    const person = await mkUser('Teacher');
    const admin1 = await mkUser('Admin1');
    const admin2 = await mkUser('Admin2');
    const seed = async (o: {
      status?: string;
      kind?: string;
      writeRequested?: boolean;
      requestedAgo?: string;
    }) => {
      const id = randomUUID();
      const emergency = o.kind === 'EMERGENCY';
      await ds.query(
        `INSERT INTO impersonation_sessions
           (id, platform_admin_id, tenant_id, target_user_id, role, status, entry_kind, view_only,
            write_locked, write_requested_at, reason, requested_at, started_at, expires_at)
         VALUES ($1,$2,$3,$4,'TEACHER',$5,$6,true,$7,$8,'Help with marks',
                 now() - $9::interval, $10, $11)`,
        [
          id,
          owner.id,
          school.id,
          person.id,
          o.status ?? 'REQUESTED',
          o.kind ?? 'NORMAL',
          emergency,
          o.writeRequested ? new Date() : null,
          o.requestedAgo ?? '1 minute',
          emergency ? new Date() : null,
          emergency ? new Date(Date.now() + 3600_000) : null,
        ],
      );
      return id;
    };
    return { school, owner, person, admin1, admin2, seed };
  }

  const row = async (id: string) =>
    (await ds.query('SELECT * FROM impersonation_sessions WHERE id = $1', [id]))[0];
  const audits = (id: string, action: AuditAction) =>
    ds.query('SELECT tenant_id, new_values FROM audit_logs WHERE entity_id = $1 AND action = $2', [
      id,
      action,
    ]);

  it('two admins approving at once: exactly one 200, the other 409 ALREADY_DECIDED, one audit row', async () => {
    const w = await world();
    const id = await w.seed({});
    const results = await Promise.allSettled([
      svc.approve(w.school.id, w.admin1.id, id),
      svc.approve(w.school.id, w.admin2.id, id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.getStatus()).toBe(409);
    expect(lost.reason.getResponse().details.code).toBe('ALREADY_DECIDED');
    const r = await row(id);
    expect(r.status).toBe('APPROVED');
    expect(r.ticket_expires_at).not.toBeNull();
    expect(await audits(id, AuditAction.SUPPORT_ACCESS_APPROVED)).toHaveLength(1);
    expect(ticketReady).toHaveBeenCalledTimes(1);
  });

  it('a request of school B is 404 for an admin of A and stays untouched; not in A list', async () => {
    const a = await world();
    const b = await world();
    const id = await b.seed({});
    await expect(svc.approve(a.school.id, a.admin1.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.deny(a.school.id, a.admin1.id, id)).rejects.toMatchObject({ status: 404 });
    expect((await row(id)).status).toBe('REQUESTED');
    expect(await svc.list(a.school.id)).toHaveLength(0);
    expect((await svc.list(b.school.id)).map((x) => x.id)).toEqual([id]);
    await expect(svc.get(a.school.id, id)).rejects.toMatchObject({ status: 404 });
    expect(await svc.get(b.school.id, id)).toMatchObject({ id, status: 'REQUESTED' });
  });

  it('get reaches a request past the first list page; list pages with offset', async () => {
    const w = await world();
    const first = await w.seed({ requestedAgo: '3 hours' });
    const second = await w.seed({ requestedAgo: '2 hours' });
    expect((await svc.list(w.school.id, undefined, 1, 1)).map((x) => x.id)).toEqual([second]);
    expect((await svc.list(w.school.id, undefined, 1, 2)).map((x) => x.id)).toEqual([first]);
    expect(await svc.get(w.school.id, first)).toMatchObject({ id: first });
  });

  it('an expired (over 24 h) row is shown EXPIRED and cannot be approved', async () => {
    const w = await world();
    const id = await w.seed({ requestedAgo: '25 hours' });
    await expect(svc.approve(w.school.id, w.admin1.id, id)).rejects.toMatchObject({ status: 409 });
    expect((await row(id)).status).toBe('REQUESTED');
    expect(await svc.list(w.school.id, SupportRequestListStatus.PENDING)).toHaveLength(0);
    const decided = await svc.list(w.school.id, SupportRequestListStatus.DECIDED);
    expect(decided[0]).toMatchObject({ id, status: 'EXPIRED', kind: 'ASK' });
  });

  it('deny of an ASK sets DENIED and audits; no ticket notice', async () => {
    const w = await world();
    ticketReady.mockClear();
    const id = await w.seed({});
    await svc.deny(w.school.id, w.admin1.id, id);
    expect((await row(id)).status).toBe('DENIED');
    expect(await audits(id, AuditAction.SUPPORT_ACCESS_DENIED)).toHaveLength(1);
    expect(ticketReady).not.toHaveBeenCalled();
  });

  it('approving a WRITE request unlocks the live session in the DB and in Redis, TTL kept', async () => {
    const w = await world();
    const id = await w.seed({ status: 'ACTIVE', kind: 'EMERGENCY', writeRequested: true });
    await redis.set(
      impKey(id),
      JSON.stringify({
        adminId: w.owner.id,
        userId: w.person.id,
        schoolId: w.school.id,
        role: 'TEACHER',
        viewOnly: true,
        writeLocked: true,
        kind: 'EMERGENCY',
      }),
      'EX',
      3000,
    );
    const pending = await svc.list(w.school.id);
    expect(pending[0]).toMatchObject({ id, kind: 'WRITE', status: 'REQUESTED' });

    await svc.approve(w.school.id, w.admin1.id, id);
    const r = await row(id);
    expect(r.status).toBe('ACTIVE');
    expect(r.write_locked).toBe(false);
    expect(r.write_requested_at).toBeNull();
    const live = JSON.parse((await redis.get(impKey(id)))!);
    expect(live.writeLocked).toBe(false);
    expect(await redis.ttl(impKey(id))).toBeGreaterThan(2000);
    expect(await audits(id, AuditAction.SUPPORT_ACCESS_APPROVED)).toHaveLength(1);
    // A second admin loses.
    await expect(svc.approve(w.school.id, w.admin2.id, id)).rejects.toMatchObject({ status: 409 });
  });

  it('denying a WRITE request clears the marker, keeps the session ACTIVE and read-only', async () => {
    const w = await world();
    const id = await w.seed({ status: 'ACTIVE', kind: 'EMERGENCY', writeRequested: true });
    await svc.deny(w.school.id, w.admin1.id, id);
    const r = await row(id);
    expect(r.status).toBe('ACTIVE');
    expect(r.write_locked).toBe(true);
    expect(r.write_requested_at).toBeNull();
    expect(await svc.list(w.school.id)).toHaveLength(0);
  });

  it('approving a WRITE whose session key is gone is 409 and grants nothing', async () => {
    const w = await world();
    const id = await w.seed({ status: 'ACTIVE', kind: 'EMERGENCY', writeRequested: true });
    await redis.del(impKey(id));
    await expect(svc.approve(w.school.id, w.admin1.id, id)).rejects.toMatchObject({ status: 409 });
    expect((await row(id)).write_locked).toBe(true);
  });
});
