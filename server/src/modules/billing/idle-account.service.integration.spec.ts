import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { SchoolsService } from '../schools/schools.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { DAY_MS } from '../schools/trial/trial.constants';
import { IdleAccountService } from './idle-account.service';

describe('IdleAccountService (integration)', () => {
  let ds: DataSource;
  let service: IdleAccountService;
  // Fixed "today", so every age below is exact.
  const now = new Date('2026-12-01T06:00:00Z');
  const findAllActive = vi.fn();
  const notifyAdmins = vi.fn();
  const invalidate = vi.fn();
  const platformTenantId = vi.fn();
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      IdleAccountService,
      AuditService,
      SessionCutoffService,
      { provide: SchoolsService, useValue: { findAllActive } },
      { provide: TenantStatusService, useValue: { invalidate, platformTenantId } },
      { provide: AdminNoticeService, useValue: { notifyAdmins } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(IdleAccountService);
  }, 60000);

  beforeEach(() => {
    notifyAdmins.mockReset().mockResolvedValue(undefined);
    invalidate.mockReset().mockResolvedValue(undefined);
    platformTenantId.mockReset().mockResolvedValue(null);
    // Only the schools the test made are checked, never the shared seed school.
    findAllActive.mockReset().mockImplementation(async () => schoolIds.map((id) => ({ id })));
  });

  afterEach(async () => {
    await ds.query('DELETE FROM seat_orders WHERE school_id = ANY($1)', [schoolIds]);
    await ds.query('DELETE FROM students WHERE tenant_id = ANY($1)', [schoolIds]);
    await ds.query('DELETE FROM user_tenants WHERE tenant_id = ANY($1)', [schoolIds]);
    await ds.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    // audit_logs is append-only, so the school rows stay; they are made inactive instead.
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', deleted_at = NOW() WHERE id = ANY($1)`,
      [schoolIds],
    );
    schoolIds.length = 0;
    userIds.length = 0;
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  /** An ACTIVE school created `ageDays` before `now`. */
  const newSchool = async (
    ageDays: number,
    opts: {
      status?: 'ACTIVE' | 'SUSPENDED';
      reason?: string | null;
      statusChangedDaysAgo?: number | null;
      warnings?: Record<string, number>; // key -> days before `now`
    } = {},
  ): Promise<string> => {
    const id = randomUUID();
    const warnings = Object.fromEntries(
      Object.entries(opts.warnings ?? {}).map(([k, d]) => [
        k,
        new Date(now.getTime() - d * DAY_MS).toISOString(),
      ]),
    );
    await ds.query(
      `INSERT INTO schools (id, name, slug, status, status_reason, status_changed_at, onboarding, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
      [
        id,
        `Idle ${id.slice(0, 6)}`,
        `idle-${id.slice(0, 8)}`,
        opts.status ?? 'ACTIVE',
        opts.reason ?? null,
        opts.statusChangedDaysAgo == null
          ? null
          : new Date(now.getTime() - opts.statusChangedDaysAgo * DAY_MS),
        JSON.stringify({ seen_by: 'kept', idle_warnings: warnings }),
        new Date(now.getTime() - ageDays * DAY_MS),
      ],
    );
    schoolIds.push(id);
    return id;
  };
  const addStudent = async (tenantId: string) => {
    await ds.query(
      `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES ($1, 'Seat Holder', $2, 1, $3)`,
      [tenantId, `R-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID],
    );
  };
  const addMember = async (tenantId: string): Promise<string> => {
    const uid = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'Idle Member', 'ACTIVE', NOW(), NOW())`,
      [uid, `${uid}@idle.example`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [uid, tenantId],
    );
    userIds.push(uid);
    return uid;
  };
  const row = async (id: string) =>
    (
      await ds.query(
        `SELECT status, status_reason, status_changed_at, deleted_at, onboarding FROM schools WHERE id = $1`,
        [id],
      )
    )[0];
  const auditActions = async (id: string): Promise<string[]> =>
    (await ds.query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [id])).map(
      (r: { action: string }) => r.action,
    );

  it('day 19: writes nothing and sends nothing', async () => {
    const id = await newSchool(19);
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect((await row(id)).onboarding.idle_warnings).toEqual({});
  });

  it('day 20: sends idle_d20 once and stamps an ISO time, keeping other onboarding keys', async () => {
    const id = await newSchool(20);
    const result = await service.runDaily(now);
    expect(result.notified).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'idle_d20');
    const onboarding = (await row(id)).onboarding;
    expect(onboarding.idle_warnings.idle_d20).toBe(now.toISOString());
    expect(onboarding.seen_by).toBe('kept');
  });

  it('a second run on the same day sends no duplicate', async () => {
    await newSchool(20);
    await service.runDaily(now);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('day 25 with one ACTIVE student: nothing happens (adding a student is the cancel)', async () => {
    const id = await newSchool(25);
    await addStudent(id);
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe('ACTIVE');
  });

  it('day 27: sends idle_d27 only', async () => {
    const id = await newSchool(27, { warnings: { idle_d20: 7 } });
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'idle_d27');
  });

  it('day 30 with idle_d27 sent only 1 day ago: not suspended yet (the 3-day gap)', async () => {
    const id = await newSchool(30, { warnings: { idle_d20: 10, idle_d27: 1 } });
    const result = await service.runDaily(now);
    expect(result.suspended).toBe(0);
    expect((await row(id)).status).toBe('ACTIVE');
  });

  it('day 30 with idle_d27 sent a few seconds under 3 days ago: still suspended (slack)', async () => {
    const id = await newSchool(30, { warnings: { idle_d27: 3 - 10 / 86400 } });
    const result = await service.runDaily(now);
    expect(result.suspended).toBe(1);
    expect((await row(id)).status).toBe('SUSPENDED');
  });

  it('a school with a PAID seat order is never warned or suspended, even with no students', async () => {
    const id = await newSchool(30, { warnings: { idle_d20: 10, idle_d27: 5 } });
    // An old, expired order still counts: the school has been a paying customer.
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 5, 1, 1000, 5000, '2020-01-01', '2020-02-01', 'PAID', $2)`,
      [id, randomUUID()],
    );
    const result = await service.runDaily(now);
    expect(result).toMatchObject({ notified: 0, suspended: 0 });
    expect((await row(id)).status).toBe('ACTIVE');
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('a failed cut-off for one member does not stop the notice or the other members', async () => {
    const id = await newSchool(30, { warnings: { idle_d20: 10, idle_d27: 3 } });
    await addMember(id);
    await addMember(id);
    const cutOff = vi.spyOn(SessionCutoffService.prototype, 'cutOff');
    cutOff.mockRejectedValueOnce(new Error('db blip'));
    try {
      const result = await service.runDaily(now);
      expect(result.suspended).toBe(1);
      expect(cutOff).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenCalledWith(id);
      expect(notifyAdmins).toHaveBeenCalledWith(id, 'idle_suspended');
    } finally {
      cutOff.mockRestore();
    }
  });

  it('day 30 with idle_d27 sent 3 days ago: suspended IDLE, sessions cut, admins told', async () => {
    const id = await newSchool(30, { warnings: { idle_d20: 10, idle_d27: 3 } });
    const u1 = await addMember(id);
    const u2 = await addMember(id);
    const result = await service.runDaily(now);

    expect(result.suspended).toBe(1);
    const school = await row(id);
    expect(school.status).toBe('SUSPENDED');
    expect(school.status_reason).toBe('IDLE');
    expect(new Date(school.status_changed_at).toISOString()).toBe(now.toISOString());
    expect(await auditActions(id)).toContain('SUSPEND');
    // Rule 8: every member's old access tokens are refused from now on.
    const users = await ds.query(`SELECT tokens_valid_after FROM users WHERE id = ANY($1)`, [
      [u1, u2],
    ]);
    expect(users).toHaveLength(2);
    for (const u of users) expect(u.tokens_valid_after).not.toBeNull();
    expect(invalidate).toHaveBeenCalledWith(id);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'idle_suspended');
  });

  it('legacy school (45 days, no warnings): idle_d27 first, suspended only 3 days later', async () => {
    const id = await newSchool(45);
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'idle_d27');
    expect((await row(id)).status).toBe('ACTIVE');

    // Three days later the notice is old enough, so the school is suspended.
    await service.runDaily(new Date(now.getTime() + 3 * DAY_MS));
    expect((await row(id)).status).toBe('SUSPENDED');
  });

  it('a reactivated school restarts its clock, and a warning from before it does not count', async () => {
    // Created 100 days ago but reactivated 5 days ago: nothing to do.
    const fresh = await newSchool(100, { statusChangedDaysAgo: 5 });
    await service.runDaily(now);
    expect(notifyAdmins).not.toHaveBeenCalled();
    expect((await row(fresh)).status).toBe('ACTIVE');

    // Reactivated 22 days ago; the idle_d27 stamp (40 days ago) is older than the clock, so it
    // is "not sent" and the school gets idle_d20, not a suspension.
    const stale = await newSchool(100, { statusChangedDaysAgo: 22, warnings: { idle_d27: 40 } });
    await service.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledWith(stale, 'idle_d20');
    expect((await row(stale)).status).toBe('ACTIVE');
  });

  it('soft-deletes an IDLE school suspended 31 days ago, and leaves the others alone', async () => {
    const due = await newSchool(90, {
      status: 'SUSPENDED',
      reason: 'IDLE',
      statusChangedDaysAgo: 31,
    });
    const young = await newSchool(90, {
      status: 'SUSPENDED',
      reason: 'IDLE',
      statusChangedDaysAgo: 29,
    });
    const other = await newSchool(90, {
      status: 'SUSPENDED',
      reason: 'SEATS_EXPIRED',
      statusChangedDaysAgo: 40,
    });
    const result = await service.runDaily(now);

    expect(result.deleted).toBe(1);
    expect(new Date((await row(due)).deleted_at).toISOString()).toBe(now.toISOString());
    expect(await auditActions(due)).toContain('DELETE');
    expect((await row(young)).deleted_at).toBeNull();
    expect((await row(other)).deleted_at).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(due);
  });

  it('never soft-deletes an IDLE school that has a PAID seat order', async () => {
    const paid = await newSchool(90, {
      status: 'SUSPENDED',
      reason: 'IDLE',
      statusChangedDaysAgo: 31,
    });
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 5, 1, 1000, 5000, '2020-01-01', '2020-02-01', 'PAID', $2)`,
      [paid, randomUUID()],
    );
    const result = await service.runDaily(now);
    // A paying customer's data is never deleted by the idle job.
    expect(result.deleted).toBe(0);
    expect((await row(paid)).deleted_at).toBeNull();
  });

  it('skips the platform tenant even when it is idle', async () => {
    const platform = await newSchool(60, { warnings: { idle_d27: 10 } });
    platformTenantId.mockResolvedValue(platform);
    await service.runDaily(now);
    expect((await row(platform)).status).toBe('ACTIVE');
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('one school failing does not stop the next', async () => {
    const first = await newSchool(20);
    const second = await newSchool(20);
    notifyAdmins.mockImplementation(async (id: string) => {
      if (id === first) throw new Error('provider down');
    });
    const result = await service.runDaily(now);
    expect(result.failed).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledWith(second, 'idle_d20');
  });
});
