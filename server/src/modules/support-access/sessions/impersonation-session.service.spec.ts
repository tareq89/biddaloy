import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  AuditAction,
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  SupportAccessMode,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { SchoolSettingsReader } from '../../schools/settings/school-settings-reader.service';
import { School } from '../../schools/entities/school.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { PlatformAdmin } from '../../platform-identity/entities/platform-admin.entity';
import { ImpersonationSession } from '../entities/impersonation-session.entity';
import { IMPERSONATION_REDIS } from './impersonation-redis';
import {
  ImpersonationSessionService,
  shownStatus,
  type CreateImpersonationInput,
} from './impersonation-session.service';

const input: CreateImpersonationInput = {
  platformAdminId: 'admin-1',
  schoolId: 'school-1',
  targetUserId: 'user-1',
  role: UserRole.TEACHER,
  reason: 'Helping with a marks import',
  viewOnly: true,
  entryKind: ImpersonationEntryKind.NORMAL,
};

const REDIS_DOWN = 'This action is temporarily unavailable. Please try again in a few minutes.';

describe('ImpersonationSessionService (unit)', () => {
  let service: ImpersonationSessionService;
  let mode: SupportAccessMode;
  // What each existence check answers, by entity.
  let exists: Map<unknown, boolean>;
  let user: { status: UserStatus } | null;
  let liveRows: Array<{ tenant_id: string; target_user_id: string }>;
  let endedRows: Array<Record<string, string>>;
  let expiredRows: Array<Record<string, string>>;
  let saved: unknown[];
  let grantRows: Array<Record<string, unknown>>;
  let activateRows: Array<Record<string, unknown>>;
  let approved: Record<string, unknown> | null;
  let qb: Record<string, any>;
  let rateCount: number;
  let redis: Record<string, any>;
  let audit: { record: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mode = SupportAccessMode.ALLOWED;
    exists = new Map<unknown, boolean>([
      [School, true],
      [UserTenant, true],
      [PlatformAdmin, false],
    ]);
    user = { status: UserStatus.ACTIVE };
    liveRows = [];
    endedRows = [];
    expiredRows = [];
    saved = [];
    grantRows = [];
    activateRows = [];
    approved = null;
    rateCount = 1;
    const manager: Record<string, any> = {
      transaction: (cb: (m: unknown) => unknown) => cb(manager),
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('pg_advisory')) return [];
        if (sql.includes('write_locked = false')) return [grantRows, grantRows.length];
        if (sql.includes("SET status = 'ACTIVE'")) return [activateRows, activateRows.length];
        if (params[0] === 'EXPIRED') return [expiredRows, expiredRows.length];
        return [endedRows, endedRows.length];
      }),
      exists: vi.fn(async (entity: unknown) => exists.get(entity)),
      findOne: vi.fn(async (entity: unknown) =>
        entity === ImpersonationSession ? approved : user,
      ),
      find: vi.fn(async () => liveRows),
      create: (_e: unknown, v: object) => v,
      save: vi.fn(async (_e: unknown, v: object) => {
        saved.push(v);
        return { id: 'sid-1', ...v };
      }),
    };
    redis = {
      multi: () => ({
        incr: () => ({
          ttl: () => ({
            exec: async () => [
              [null, rateCount],
              [null, 3000],
            ],
          }),
        }),
      }),
      expire: vi.fn(),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
    };
    qb = {};
    for (const f of ['innerJoin', 'addSelect', 'withDeleted', 'where', 'andWhere', 'orderBy']) {
      qb[f] = vi.fn(() => qb);
    }
    qb.limit = vi.fn(() => qb);
    qb.getRawAndEntities = vi.fn(async () => ({ entities: [], raw: [] }));
    audit = { record: vi.fn(async () => undefined) };
    const module = await Test.createTestingModule({
      providers: [
        ImpersonationSessionService,
        {
          provide: getRepositoryToken(ImpersonationSession),
          useValue: { manager, createQueryBuilder: () => qb },
        },
        { provide: IMPERSONATION_REDIS, useValue: redis },
        { provide: SchoolSettingsReader, useValue: { supportAccessFresh: async () => ({ mode }) } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(ImpersonationSessionService);
  });

  const refusal = async (p: Promise<unknown>) => {
    const e: any = await p.then(
      () => null,
      (err) => err,
    );
    return { status: e?.getStatus?.(), body: e?.getResponse?.() };
  };

  it('writes the row, the live key (EX <= 3600) and one STARTED row for an allowed school', async () => {
    await service.create(input);
    expect(saved).toHaveLength(1);
    const [key, json, ex, ttl] = redis.set.mock.calls[0];
    expect(key).toBe('imp:sid-1');
    expect(JSON.parse(json)).toMatchObject({
      adminId: 'admin-1',
      userId: 'user-1',
      writeLocked: false,
    });
    expect(ex).toBe('EX');
    expect(ttl).toBeLessThanOrEqual(3600);
    const started = audit.record.mock.calls.filter(
      (c) => c[0].action === AuditAction.IMPERSONATION_STARTED,
    );
    expect(started).toHaveLength(1);
    // The school is the tenant of the row; the platform admin performed it.
    expect(started[0][0]).toMatchObject({ tenant_id: 'school-1', performed_by_user_id: 'admin-1' });
  });

  it('an ask school gets a REQUESTED row, no key, no STARTED row', async () => {
    mode = SupportAccessMode.ASK;
    await service.create(input);
    expect(saved[0]).toMatchObject({ status: 'REQUESTED', expires_at: null });
    expect(redis.set).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('the 11th start in an hour answers 429 with a fixed sentence and writes nothing', async () => {
    rateCount = 11;
    const r = await refusal(service.create(input));
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('IMPERSONATION_RATE_LIMITED');
    expect(saved).toHaveLength(0);
  });

  it('a Redis error on create answers 503 and writes no row', async () => {
    redis.multi = () => {
      throw new Error('redis://secret-host timed out');
    };
    const r = await refusal(service.create(input));
    expect(r.status).toBe(503);
    expect(r.body.message).toBe(REDIS_DOWN);
    expect(saved).toHaveLength(0);
  });

  it('a Redis error on the live-key write answers 503 (the transaction rolls the row back)', async () => {
    redis.set = vi.fn(async () => {
      throw new Error('boom');
    });
    const r = await refusal(service.create(input));
    expect(r.status).toBe(503);
    expect(r.body.message).toBe(REDIS_DOWN);
  });

  describe('D26 refusals share one sentence and echo nothing', () => {
    const sentence = 'This person cannot be signed in as.';
    const expectRefused = async (i: CreateImpersonationInput = input) => {
      const r = await refusal(service.create(i));
      expect(r.status).toBe(422);
      expect(r.body.message).toBe(sentence);
      expect(JSON.stringify(r.body)).not.toContain(i.targetUserId);
      expect(saved).toHaveLength(0);
    };
    it('inactive person', async () => {
      user = { status: UserStatus.SUSPENDED };
      await expectRefused();
    });
    it('missing or soft-deleted person', async () => {
      user = null;
      await expectRefused();
    });
    it('no undeleted membership with that role in this school', async () => {
      exists.set(UserTenant, false);
      await expectRefused();
    });
    it('SUPER_ADMIN role', async () => {
      await expectRefused({ ...input, role: UserRole.SUPER_ADMIN });
    });
    it('platform admin target', async () => {
      exists.set(PlatformAdmin, true);
      await expectRefused();
    });
    it('unknown school answers a fixed 404', async () => {
      exists.set(School, false);
      const r = await refusal(service.create(input));
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('School not found.');
    });
  });

  it('a blocked school answers 403 SUPPORT_ACCESS_BLOCKED for a normal entry', async () => {
    mode = SupportAccessMode.BLOCKED;
    const r = await refusal(service.create(input));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SUPPORT_ACCESS_BLOCKED');
    expect(saved).toHaveLength(0);
  });

  it('a blocked school with an emergency entry goes ACTIVE, view-only and write-locked', async () => {
    mode = SupportAccessMode.BLOCKED;
    await service.create({
      ...input,
      viewOnly: false,
      entryKind: ImpersonationEntryKind.EMERGENCY,
    });
    expect(saved[0]).toMatchObject({
      status: 'ACTIVE',
      entry_kind: 'EMERGENCY',
      view_only: true,
      write_locked: true,
    });
  });

  it.each([SupportAccessMode.ALLOWED, SupportAccessMode.ASK])(
    'an emergency entry in %s mode is refused 409 and writes nothing',
    async (m) => {
      mode = m;
      const r = await refusal(
        service.create({ ...input, entryKind: ImpersonationEntryKind.EMERGENCY }),
      );
      expect(r.status).toBe(409);
      expect(saved).toHaveLength(0);
    },
  );

  it('refuses a 4th distinct live session and ends nothing', async () => {
    liveRows = [1, 2, 3].map((n) => ({ tenant_id: 'school-1', target_user_id: `other-${n}` }));
    const r = await refusal(service.create(input));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOO_MANY_LIVE_SESSIONS');
    expect(saved).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a same-person start replaces the older row: one ENDED(REPLACED), its key deleted, then the new row', async () => {
    // Three live already, one of them is this same person: no 4th session, so it is allowed.
    liveRows = [
      { tenant_id: 'school-1', target_user_id: 'user-1' },
      { tenant_id: 'school-1', target_user_id: 'o2' },
      { tenant_id: 'school-1', target_user_id: 'o3' },
    ];
    endedRows = [
      {
        id: 'old-sid',
        tenant_id: 'school-1',
        platform_admin_id: 'admin-1',
        target_user_id: 'user-1',
        role: 'TEACHER',
      },
    ];
    await service.create(input);
    const ended = audit.record.mock.calls.filter(
      (c) => c[0].action === AuditAction.IMPERSONATION_ENDED,
    );
    expect(ended).toHaveLength(1);
    expect(ended[0][0].new_values.ended_by).toBe(ImpersonationEndedBy.REPLACED);
    expect(redis.del).toHaveBeenCalledWith('imp:old-sid');
    expect(saved).toHaveLength(1);
  });

  describe('end paths write exactly one ENDED row', () => {
    const row = {
      id: 'sid-9',
      tenant_id: 'school-1',
      platform_admin_id: 'admin-1',
      target_user_id: 'user-1',
      role: 'TEACHER',
    };
    const endedCount = () =>
      audit.record.mock.calls.filter((c) => c[0].action === AuditAction.IMPERSONATION_ENDED).length;

    it('end', async () => {
      endedRows = [row];
      expect(await service.end('sid-9', ImpersonationEndedBy.OWNER)).toBe(true);
      expect(endedCount()).toBe(1);
      expect(redis.del).toHaveBeenCalledWith('imp:sid-9');
    });
    it('end of a session already over writes nothing', async () => {
      expect(await service.end('sid-9', ImpersonationEndedBy.OWNER)).toBe(false);
      expect(endedCount()).toBe(0);
    });
    it('revokeAllForSchool', async () => {
      endedRows = [row];
      expect(await service.revokeAllForSchool('school-1', ImpersonationEndedBy.MODE_BLOCKED)).toBe(
        1,
      );
      expect(endedCount()).toBe(1);
    });
    it('revokeAllForAdmin', async () => {
      endedRows = [row];
      expect(await service.revokeAllForAdmin('admin-1', ImpersonationEndedBy.LOCKED)).toBe(1);
      expect(endedCount()).toBe(1);
    });
    it('lazy expiry writes the missing ENDED row once and does not touch Redis', async () => {
      expiredRows = [row];
      await service.end('sid-9', ImpersonationEndedBy.OWNER);
      expect(endedCount()).toBe(1);
      expect(audit.record.mock.calls[0][0].new_values.ended_by).toBe(ImpersonationEndedBy.EXPIRED);
      expect(redis.del).not.toHaveBeenCalled();
    });
    it('a Redis error on DEL answers 503 so the end rolls back and can be retried', async () => {
      endedRows = [row];
      redis.del = vi.fn(async () => {
        throw new Error('down');
      });
      const r = await refusal(service.end('sid-9', ImpersonationEndedBy.OWNER));
      expect(r.status).toBe(503);
    });
  });

  describe('rate limit fails closed', () => {
    const exec = (result: unknown) => {
      redis.multi = () => ({ incr: () => ({ ttl: () => ({ exec: async () => result }) }) });
    };
    it('a per-command error answers 503, not "under the limit"', async () => {
      exec([
        [new Error('LOADING'), null],
        [null, 3000],
      ]);
      expect((await refusal(service.create(input))).status).toBe(503);
      expect(saved).toHaveLength(0);
    });
    it('a null result answers 503', async () => {
      exec(null);
      expect((await refusal(service.create(input))).status).toBe(503);
    });
    it('a non-integer count answers 503', async () => {
      exec([
        [null, 'x'],
        [null, 3000],
      ]);
      expect((await refusal(service.create(input))).status).toBe(503);
    });
  });

  it('the Redis-down sentence equals the one @FailClosedWithoutRedis answers', () => {
    // The guard's sentence is not exported, so compare against its source text.
    const guard = readFileSync(
      join(__dirname, '../../../common/rate-limit/app-throttler.guard.ts'),
      'utf8',
    );
    expect(guard.replace(/\s+/g, ' ')).toContain(REDIS_DOWN);
  });

  it('an ask-mode request never ends a live session of the same person', async () => {
    mode = SupportAccessMode.ASK;
    await service.create(input);
    const sqls = (service as any).repo.manager.query.mock.calls.map((c: unknown[]) => c[1]);
    expect(sqls.some((p: unknown[]) => p?.[1] === ImpersonationEndedBy.REPLACED)).toBe(false);
  });

  describe('activate', () => {
    beforeEach(() => {
      approved = {
        id: 'sid-7',
        platform_admin_id: 'admin-1',
        tenant_id: 'school-1',
        target_user_id: 'user-1',
        role: 'TEACHER',
        entry_kind: 'NORMAL',
        view_only: true,
        write_locked: false,
        reason: 'r',
        status: 'APPROVED',
      };
      activateRows = [{ id: 'sid-7' }];
    });
    it('writes the live key and one STARTED row, and replaces an older live row of the same person', async () => {
      endedRows = [
        {
          id: 'old',
          tenant_id: 'school-1',
          platform_admin_id: 'admin-1',
          target_user_id: 'user-1',
          role: 'TEACHER',
        },
      ];
      await service.activate('sid-7');
      expect(redis.set.mock.calls[0][0]).toBe('imp:sid-7');
      const actions = audit.record.mock.calls.map((c) => c[0].action);
      expect(actions).toContain(AuditAction.IMPERSONATION_STARTED);
      expect(redis.del).toHaveBeenCalledWith('imp:old');
    });
    it('re-checks D26: a person suspended since approval is refused', async () => {
      user = { status: UserStatus.SUSPENDED };
      const r = await refusal(service.activate('sid-7'));
      expect(r.status).toBe(422);
      expect(redis.set).not.toHaveBeenCalled();
    });
    it('answers 409 when the ticket is not APPROVED any more', async () => {
      activateRows = [];
      expect((await refusal(service.activate('sid-7'))).status).toBe(409);
      expect(redis.set).not.toHaveBeenCalled();
    });
    it('answers 403 when the school has blocked since approval', async () => {
      mode = SupportAccessMode.BLOCKED;
      expect((await refusal(service.activate('sid-7'))).status).toBe(403);
    });
  });

  describe('grantWrite', () => {
    const live = {
      platform_admin_id: 'admin-1',
      target_user_id: 'user-1',
      tenant_id: 'school-1',
      role: 'TEACHER',
      view_only: true,
      entry_kind: 'NORMAL',
      write_locked: false,
    };
    it('rewrites the key with KEEPTTL XX and writeLocked false', async () => {
      grantRows = [live];
      await service.grantWrite('sid-1');
      const [key, json, a, b] = redis.set.mock.calls[0];
      expect(key).toBe('imp:sid-1');
      expect(JSON.parse(json).writeLocked).toBe(false);
      expect([a, b]).toEqual(['KEEPTTL', 'XX']);
    });
    it('a row that is not live (zero rows from the conditional UPDATE) answers 409', async () => {
      const r = await refusal(service.grantWrite('sid-1'));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('SESSION_NOT_LIVE');
    });
    it('a key that is gone (SET XX answers null) answers 409', async () => {
      grantRows = [live];
      redis.set = vi.fn(async () => null);
      expect((await refusal(service.grantWrite('sid-1'))).status).toBe(409);
    });
  });

  describe('list limit', () => {
    it('caps a limit of 500 at 100', async () => {
      await service.listRecent({ limit: 500 });
      expect(qb.limit).toHaveBeenCalledWith(100);
    });

    it('raises a limit of 0 to 1', async () => {
      await service.listRecent({ limit: 0 });
      expect(qb.limit).toHaveBeenCalledWith(1);
    });

    it('raises a negative limit to 1', async () => {
      await service.listRecent({ limit: -3 });
      expect(qb.limit).toHaveBeenCalledWith(1);
    });

    it('keeps a limit of 25', async () => {
      await service.listRecent({ limit: 25 });
      expect(qb.limit).toHaveBeenCalledWith(25);
    });
  });

  it('shownStatus shows an ACTIVE row past its expiry as EXPIRED', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    expect(
      shownStatus({ status: 'ACTIVE', expires_at: new Date('2026-01-01T09:00:00Z') }, now),
    ).toBe('EXPIRED');
    expect(
      shownStatus({ status: 'ACTIVE', expires_at: new Date('2026-01-01T11:00:00Z') }, now),
    ).toBe('ACTIVE');
    expect(shownStatus({ status: 'ENDED', expires_at: null }, now)).toBe('ENDED');
  });
});
