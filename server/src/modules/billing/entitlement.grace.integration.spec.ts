import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { EntitlementService } from './entitlement.service';
import { readOnlyUntilFor } from './seat-grace';

/**
 * Epic 49 D9: over the seats -> 7 days read-only -> suspended -> a paid order lifts both.
 * Dates are school-local (Asia/Dhaka, UTC+6). The last paid period below ends 2026-12-01, so the
 * grace ends at 2026-12-08 00:00 +06:00 = 2026-12-07T18:00:00Z.
 */
describe('Seat grace (integration)', () => {
  let ds: DataSource;
  let entitlement: EntitlementService;
  let sessionCutoff: SessionCutoffService;
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;
  const invalidate = vi.fn();
  const platformTenantId = vi.fn();
  const notifyAdmins = vi.fn();
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  // Day 3 after the period ended: still inside grace. Day 9: grace is over.
  const inGrace = new Date('2026-12-04T06:00:00Z');
  const afterGrace = new Date('2026-12-10T06:00:00Z');
  const GRACE_END = new Date('2026-12-07T18:00:00Z');

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      AuditService,
      SessionCutoffService,
      { provide: TenantStatusService, useValue: { invalidate, platformTenantId } },
      { provide: AdminNoticeService, useValue: { notifyAdmins } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    entitlement = module.get(EntitlementService);
    sessionCutoff = module.get(SessionCutoffService);
  }, 60000);

  beforeEach(() => {
    process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00'; // billing applies
    invalidate.mockReset().mockResolvedValue(undefined);
    notifyAdmins.mockReset().mockResolvedValue(undefined);
    platformTenantId.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
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

  const newSchool = async (seatLimit: number | null, students: number): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, status, seat_limit, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', $4, NOW(), NOW())`,
      [id, `Grace ${id.slice(0, 6)}`, `grace-${id.slice(0, 8)}`, seatLimit],
    );
    schoolIds.push(id);
    for (let i = 0; i < students; i++) await addStudent(id);
    return id;
  };
  // roll_number is unique per class section across all schools.
  let nextRoll = 700000 + Math.floor(Math.random() * 200000);
  const addStudent = async (tenantId: string) => {
    await ds.query(
      `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES ($1, 'Seat Holder', $2, $4, $3)`,
      [tenantId, `R-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID, nextRoll++],
    );
  };
  const addMember = async (tenantId: string): Promise<string> => {
    const uid = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'Grace Member', 'ACTIVE', NOW(), NOW())`,
      [uid, `${uid}@grace.example`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [uid, tenantId],
    );
    userIds.push(uid);
    return uid;
  };
  const addOrder = async (schoolId: string, seats: number, start: string, end: string) => {
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, $2, 1, 1000, $3, $4, $5, 'PAID', $6)`,
      [schoolId, seats, seats * 1000, start, end, randomUUID()],
    );
  };
  const statusOf = async (id: string) =>
    (await ds.query('SELECT status, status_reason FROM schools WHERE id = $1', [id]))[0] as {
      status: string;
      status_reason: string | null;
    };
  const auditEvents = async (id: string): Promise<string[]> =>
    (
      await ds.query(
        `SELECT new_values->>'event' AS e FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' LIKE 'SEATS_%'`,
        [id],
      )
    ).map((r: { e: string }) => r.e);

  /** Over its seats: 3 students against a limit of 1, paid period ended 2026-12-01. */
  const overSchool = async () => {
    const id = await newSchool(1, 3);
    await addOrder(id, 1, '2026-11-01', '2026-12-01');
    return id;
  };

  it('read-only until = end of the last paid period + 7 days at school-local midnight', async () => {
    const id = await overSchool();
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(GRACE_END);
  });

  it('a school that never paid counts from BILLING_FREE_UNTIL', async () => {
    process.env.BILLING_FREE_UNTIL = '2026-11-30T00:00:00+06:00';
    const id = await newSchool(0, 1);
    // 2026-11-30 + 7 days, local midnight.
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(new Date('2026-12-06T18:00:00Z'));
  });

  it('is null when the school is not over, unlimited, or when the extra students belong to another school', async () => {
    const fits = await newSchool(3, 3);
    expect(await readOnlyUntilFor(ds, fits, inGrace)).toBeNull();
    const unlimited = await newSchool(null, 5);
    expect(await readOnlyUntilFor(ds, unlimited, inGrace)).toBeNull();
    // Tenant isolation: another school's students never count against this one.
    const small = await newSchool(1, 1);
    await newSchool(1, 4);
    expect(await readOnlyUntilFor(ds, small, inGrace)).toBeNull();
  });

  it('does not suspend before the grace ends', async () => {
    const id = await overSchool();
    expect(await entitlement.suspendIfGraceOver(id, inGrace)).toBe(false);
    expect(await statusOf(id)).toEqual({ status: 'ACTIVE', status_reason: null });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('suspends after the grace: reason, audit, every member cut off, admins told, cache cleared', async () => {
    const id = await overSchool();
    const a = await addMember(id);
    const b = await addMember(id);
    const before = Date.now();

    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);

    expect(await statusOf(id)).toEqual({ status: 'SUSPENDED', status_reason: 'SEATS_EXPIRED' });
    expect(await auditEvents(id)).toEqual(['SEATS_SUSPENDED']);
    // Rule 8: both members' old tokens are refused from now on.
    const rows = await ds.query('SELECT tokens_valid_after FROM users WHERE id = ANY($1)', [
      [a, b],
    ]);
    for (const r of rows)
      expect(new Date(r.tokens_valid_after).getTime()).toBeGreaterThanOrEqual(before);
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'seats_suspended');
    expect(invalidate).toHaveBeenCalledWith(id);
  });

  it('a second call does nothing (already suspended)', async () => {
    const id = await overSchool();
    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);
    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(false);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('is safe for any school: not over, unlimited, unknown id and the platform tenant all return false', async () => {
    const fits = await newSchool(3, 3);
    const unlimited = await newSchool(null, 5);
    const platform = await overSchool();
    platformTenantId.mockResolvedValue(platform);
    expect(await entitlement.suspendIfGraceOver(fits, afterGrace)).toBe(false);
    expect(await entitlement.suspendIfGraceOver(unlimited, afterGrace)).toBe(false);
    expect(await entitlement.suspendIfGraceOver(randomUUID(), afterGrace)).toBe(false);
    expect(await entitlement.suspendIfGraceOver(platform, afterGrace)).toBe(false);
    expect(await statusOf(platform)).toEqual({ status: 'ACTIVE', status_reason: null });
  });

  it('a failing admin notice is logged; the school stays suspended and the call still reports it', async () => {
    const id = await overSchool();
    await addMember(id);
    notifyAdmins.mockRejectedValueOnce(new Error('sms down'));
    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);
    expect(await statusOf(id)).toMatchObject({ status: 'SUSPENDED' });
  });

  it('one member failing to be cut off does not skip the other members or the notice', async () => {
    const id = await overSchool();
    const a = await addMember(id);
    const b = await addMember(id);
    const before = Date.now();
    // First member's cut-off throws; the second must still be cut off.
    const spy = vi.spyOn(sessionCutoff, 'cutOff').mockRejectedValueOnce(new Error('db blip'));
    try {
      expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);
    } finally {
      spy.mockRestore();
    }
    const rows: { id: string; tokens_valid_after: string | null }[] = await ds.query(
      'SELECT id, tokens_valid_after FROM users WHERE id = ANY($1)',
      [[a, b]],
    );
    const cutOff = rows.filter(
      (r) => r.tokens_valid_after && new Date(r.tokens_valid_after).getTime() >= before,
    );
    expect(cutOff).toHaveLength(1); // exactly the one that did not fail
    expect(notifyAdmins).toHaveBeenCalledWith(id, 'seats_suspended');
  });

  it('anchor: the last order ended BEFORE the free period ended -> counts from the free-period end', async () => {
    process.env.BILLING_FREE_UNTIL = '2026-11-30T00:00:00+06:00';
    const id = await newSchool(1, 3);
    await addOrder(id, 1, '2026-09-01', '2026-10-01');
    // 2026-11-30 + 7 days, local midnight (not 2026-10-08).
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(new Date('2026-12-06T18:00:00Z'));
  });

  it('anchor: a school registered AFTER the free period counts from its registration day', async () => {
    const id = await newSchool(0, 1);
    await ds.query(`UPDATE schools SET created_at = '2026-12-02T06:00:00Z' WHERE id = $1`, [id]);
    // free period ended 2000; registered 2026-12-02 -> grace ends 2026-12-09 00:00 +06.
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(new Date('2026-12-08T18:00:00Z'));
  });

  it('anchor: over in the MIDDLE of a paid period (no order has ended) still gets a full window', async () => {
    const id = await newSchool(1, 3);
    await ds.query(`UPDATE schools SET created_at = '2026-11-01T06:00:00Z' WHERE id = $1`, [id]);
    await addOrder(id, 1, '2026-12-01', '2027-01-01'); // current period, not yet ended
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(new Date('2026-11-07T18:00:00Z'));
  });

  it('paying reactivates the suspended school inside the caller transaction, even if the limit value is unchanged', async () => {
    const id = await overSchool();
    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);
    // The school bought enough seats for its 3 students for the current period.
    await addOrder(id, 3, '2026-12-01', '2027-01-01');
    // Limit already equals the new entitlement: only the reactivation can make this "changed".
    await ds.query('UPDATE schools SET seat_limit = 3 WHERE id = $1', [id]);

    const res = await ds.transaction((m) => entitlement.recompute(id, m, afterGrace));

    expect(res).toEqual({ changed: true, limit: 3 });
    expect(await statusOf(id)).toEqual({ status: 'ACTIVE', status_reason: null });
    expect(await auditEvents(id)).toEqual(['SEATS_SUSPENDED', 'SEATS_REACTIVATED']);
    // Writes are open again: no read-only window while within the limit.
    expect(await readOnlyUntilFor(ds, id, afterGrace)).toBeNull();
    // The caller invalidates after commit.
    await entitlement.afterCommit(id);
    expect(invalidate).toHaveBeenCalledWith(id);
  });

  it('paying during grace ends the read-only window at once', async () => {
    const id = await overSchool();
    expect(await readOnlyUntilFor(ds, id, inGrace)).toEqual(GRACE_END);
    await addOrder(id, 3, '2026-12-01', '2027-01-01');
    await entitlement.recomputeAndNotify(id, inGrace);
    expect(await readOnlyUntilFor(ds, id, inGrace)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(id);
  });

  it('a payment that still leaves the school over its seats does not reactivate it', async () => {
    const id = await overSchool();
    expect(await entitlement.suspendIfGraceOver(id, afterGrace)).toBe(true);
    await addOrder(id, 2, '2026-12-01', '2027-01-01'); // 2 seats for 3 students
    await ds.transaction((m) => entitlement.recompute(id, m, afterGrace));
    expect(await statusOf(id)).toEqual({ status: 'SUSPENDED', status_reason: 'SEATS_EXPIRED' });
  });

  it('never reactivates a suspension that is not SEATS_EXPIRED or IDLE (e.g. a platform one)', async () => {
    const id = await newSchool(5, 1);
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'PLATFORM' WHERE id = $1`,
      [id],
    );
    await addOrder(id, 5, '2026-12-01', '2027-01-01');
    await ds.transaction((m) => entitlement.recompute(id, m, afterGrace));
    expect(await statusOf(id)).toEqual({ status: 'SUSPENDED', status_reason: 'PLATFORM' });
  });

  it('lifts an IDLE suspension once a PAID order exists', async () => {
    const id = await newSchool(5, 1);
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'IDLE' WHERE id = $1`,
      [id],
    );
    await addOrder(id, 5, '2026-12-01', '2027-01-01');
    await ds.transaction((m) => entitlement.recompute(id, m, afterGrace));
    expect(await statusOf(id)).toEqual({ status: 'ACTIVE', status_reason: null });
  });
});
