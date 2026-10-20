import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CommunicationMedium, PlatformPaymentMethod } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID, SEED_TENANT_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { TenantStatusService } from '../schools/tenant-status.service';
import { StudentService, GuardianService } from '../students/students.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';

describe('EntitlementService + OrdersService (integration)', () => {
  let ds: DataSource;
  let entitlement: EntitlementService;
  let orders: OrdersService;
  let students: StudentService;
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;
  const tenantStatus = { invalidate: vi.fn().mockResolvedValue(undefined) };
  const schoolIds: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      OrdersService,
      StudentService,
      GuardianService,
      AuditService,
      { provide: TenantStatusService, useValue: tenantStatus },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    entitlement = module.get(EntitlementService);
    orders = module.get(OrdersService);
    students = module.get(StudentService);
  }, 60000);

  afterEach(async () => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
    await ds.query('DELETE FROM student_guardians');
    await ds.query('DELETE FROM enrollments WHERE tenant_id = $1', [SEED_TENANT_ID]);
    await ds.query('DELETE FROM students WHERE tenant_id = $1', [SEED_TENANT_ID]);
    for (const id of [...schoolIds, SEED_TENANT_ID]) {
      await ds.query(
        'DELETE FROM platform_payments WHERE seat_order_id IN (SELECT id FROM seat_orders WHERE school_id = $1)',
        [id],
      );
      await ds.query('DELETE FROM seat_orders WHERE school_id = $1', [id]);
    }
    await ds.getRepository(School).update(SEED_TENANT_ID, { seat_limit: null });
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const afterCutoff = () => (process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00');
  const beforeCutoff = () => (process.env.BILLING_FREE_UNTIL = '2999-01-01T00:00:00+06:00');

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Bill ${id.slice(0, 6)}`,
      slug: `bill-${id.slice(0, 8)}`,
    });
    schoolIds.push(id);
    return id;
  };
  const limitOf = async (id: string) =>
    (await ds.getRepository(School).findOneOrFail({ where: { id } })).seat_limit;
  const recomputeAuditCount = async (id: string) =>
    Number(
      (
        await ds.query(
          `SELECT count(*) AS n FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'SEAT_LIMIT_RECOMPUTED'`,
          [id],
        )
      )[0].n,
    );
  const pay = async (schoolId: string, seats: number, months = 1) => {
    const o = await orders.createPending({
      schoolId,
      seats,
      months,
      idempotency_key: randomUUID(),
      userId: null,
    });
    await orders.markPaid(o.id, { method: PlatformPaymentMethod.OFFLINE_CASH });
    return o;
  };

  it('is null before the cutoff, and 0 after it with no paid order', async () => {
    const id = await newSchool();
    beforeCutoff();
    expect(await entitlement.limitFor(ds.manager, id)).toBeNull();
    afterCutoff();
    expect(await entitlement.limitFor(ds.manager, id)).toBe(0);
  });

  it('sums overlapping paid orders and leaves out pending and expired ones', async () => {
    afterCutoff();
    const id = await newSchool();
    await pay(id, 10);
    // An overlapping PAID order (OrdersService never makes one now, but old rows may exist).
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 5, 3, 1000, 15000, (now() AT TIME ZONE 'Asia/Dhaka')::date,
               (now() AT TIME ZONE 'Asia/Dhaka')::date + interval '3 months', 'PAID', 'overlap')`,
      [id],
    );
    await orders.createPending({
      schoolId: id,
      seats: 100,
      months: 1,
      idempotency_key: randomUUID(),
      userId: null,
    }); // never paid
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 50, 1, 1000, 50000, '2020-01-01', '2020-02-01', 'PAID', 'old')`,
      [id],
    );
    expect(await entitlement.limitFor(ds.manager, id)).toBe(15);
    await entitlement.recomputeAndNotify(id); // the raw INSERT above did not recompute
    expect(await limitOf(id)).toBe(15);
  });

  const today = async (): Promise<string> =>
    (await ds.query(`SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date::text AS d`))[0].d;
  const periodOf = async (orderId: string) =>
    (
      await ds.query(
        'SELECT period_start::text AS start, period_end::text AS "end" FROM seat_orders WHERE id = $1',
        [orderId],
      )
    )[0] as { start: string; end: string };

  it('a first purchase starts today', async () => {
    afterCutoff();
    const id = await newSchool();
    const o = await pay(id, 100, 6);
    expect((await periodOf(o.id)).start).toBe(await today());
    expect(await limitOf(id)).toBe(100);
  });

  it('an early renewal starts where the paid period ends, so seats are not counted twice', async () => {
    afterCutoff();
    const id = await newSchool();
    // 100 seats, bought 5 months ago for 6 months: one month is left.
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 100, 6, 1000, 600000, (now() AT TIME ZONE 'Asia/Dhaka')::date - interval '5 months',
               (now() AT TIME ZONE 'Asia/Dhaka')::date + interval '1 month', 'PAID', 'current')`,
      [id],
    );
    const [{ end }] = await ds.query(
      `SELECT period_end::text AS "end" FROM seat_orders WHERE school_id = $1 AND idempotency_key = 'current'`,
      [id],
    );
    const renewal = await pay(id, 100, 6);
    // The renewal covers the 6 months after the current period, not today to today+6.
    expect((await periodOf(renewal.id)).start).toBe(end);
    expect(await limitOf(id)).toBe(100);
    const [{ later }] = await ds.query(
      `SELECT (period_start + interval '6 months')::date::text AS later FROM seat_orders WHERE id = $1`,
      [renewal.id],
    );
    expect((await periodOf(renewal.id)).end).toBe(later);
  });

  it('a platform GRANT starts today and adds to the seats in force (a top-up)', async () => {
    afterCutoff();
    const id = await newSchool();
    await pay(id, 40, 3);
    const grant = await orders.createPaid(
      {
        schoolId: id,
        seats: 10,
        months: 1,
        idempotency_key: randomUUID(),
        userId: null,
        unit_price_paisa: 0,
      },
      { method: PlatformPaymentMethod.GRANT, amount_paisa: '0' },
    );
    expect((await periodOf(grant.id)).start).toBe(await today());
    expect(await limitOf(id)).toBe(50);
  });

  const grant = (schoolId: string, seats: number, months: number) =>
    orders.createPaid(
      { schoolId, seats, months, idempotency_key: randomUUID(), userId: null, unit_price_paisa: 0 },
      { method: PlatformPaymentMethod.GRANT, amount_paisa: '0' },
    );

  it('a renewal starts after the purchase, not after a longer platform grant', async () => {
    afterCutoff();
    const id = await newSchool();
    const bought = await pay(id, 100, 1);
    await grant(id, 100, 12);
    const renewal = await pay(id, 100, 6);
    // The grant (12 months) must not push the school's own renewal out to next year.
    expect((await periodOf(renewal.id)).start).toBe((await periodOf(bought.id)).end);
    // The PENDING preview follows the same rule.
    const preview = await orders.createPending({
      schoolId: id,
      seats: 100,
      months: 1,
      idempotency_key: randomUUID(),
      userId: null,
    });
    expect(preview.period_start).toBe((await periodOf(renewal.id)).end);
  });

  it('a smaller buy mid-period starts today; the next full renewal still starts at the old end', async () => {
    afterCutoff();
    const id = await newSchool();
    const bought = await pay(id, 100, 6);
    const small = await pay(id, 20, 1);
    // 20 < 100 seats in force: a top-up from today, not a month tacked onto the end.
    expect((await periodOf(small.id)).start).toBe(await today());
    expect(await limitOf(id)).toBe(120);
    const renewal = await pay(id, 100, 6);
    // So the renewal is not pushed a month out (which would leave that month with 20 seats).
    expect((await periodOf(renewal.id)).start).toBe((await periodOf(bought.id)).end);
  });

  it('a purchase after the last paid period has ended starts today', async () => {
    afterCutoff();
    const id = await newSchool();
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 50, 1, 1000, 50000, '2020-01-01', '2020-02-01', 'PAID', 'old')`,
      [id],
    );
    const o = await pay(id, 20);
    expect((await periodOf(o.id)).start).toBe(await today());
    expect(await limitOf(id)).toBe(20);
  });

  it('paying lifts an IDLE suspension; another suspension reason stays', async () => {
    afterCutoff();
    const idle = await newSchool();
    const other = await newSchool();
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'IDLE' WHERE id = $1`,
      [idle],
    );
    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'PLATFORM' WHERE id = $1`,
      [other],
    );
    await pay(idle, 3);
    await pay(other, 3);
    const statusOf = async (id: string) =>
      (await ds.query('SELECT status, status_reason FROM schools WHERE id = $1', [id]))[0];
    expect(await statusOf(idle)).toEqual({ status: 'ACTIVE', status_reason: null });
    expect(await statusOf(other)).toEqual({ status: 'SUSPENDED', status_reason: 'PLATFORM' });
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'IDLE_REACTIVATED'`,
      [idle],
    );
    expect(n).toBe(1);
  });

  it('recompute writes seat_limit and audits only when it changed', async () => {
    afterCutoff();
    const id = await newSchool();
    expect((await entitlement.recomputeAndNotify(id)) && (await limitOf(id))).toBe(0);
    expect(await recomputeAuditCount(id)).toBe(1);
    expect(await entitlement.recomputeAndNotify(id)).toBe(false);
    expect(await recomputeAuditCount(id)).toBe(1);
  });

  it('createPending is idempotent: same key returns the same order, priced seats x months x 1000', async () => {
    const id = await newSchool();
    const input = { schoolId: id, seats: 4, months: 3, idempotency_key: 'k1', userId: null };
    const a = await orders.createPending(input);
    const b = await orders.createPending({ ...input });
    expect(b.id).toBe(a.id);
    expect(a.amount_paisa).toBe(12000);
    expect(a.status).toBe('PENDING');
  });

  it('a used key with a different seats or months body is 409 IDEMPOTENCY_KEY_REUSED, fixed text', async () => {
    const id = await newSchool();
    const input = { schoolId: id, seats: 4, months: 3, idempotency_key: 'k-reuse', userId: null };
    await orders.createPending(input);
    for (const changed of [{ seats: 99 }, { months: 1 }]) {
      const err = await orders.createPending({ ...input, ...changed }).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.response).toEqual({
        message: 'This idempotency key was already used for a different order',
        details: { code: 'IDEMPOTENCY_KEY_REUSED' },
      });
    }
    // The first order is untouched.
    expect((await orders.list(id, 10)).map((o) => o.seats)).toEqual([4]);
  });

  it('markPaid twice records one payment and one recompute', async () => {
    afterCutoff();
    const id = await newSchool();
    const o = await orders.createPending({
      schoolId: id,
      seats: 7,
      months: 1,
      idempotency_key: 'k2',
      userId: null,
    });
    expect(
      await orders.markPaid(o.id, { method: PlatformPaymentMethod.BKASH, gateway_ref: 'T1' }),
    ).toEqual({
      applied: true,
    });
    expect(
      await orders.markPaid(o.id, { method: PlatformPaymentMethod.BKASH, gateway_ref: 'T1' }),
    ).toEqual({
      applied: false,
    });
    const [{ n }] = await ds.query(
      'SELECT count(*) AS n FROM platform_payments WHERE seat_order_id = $1',
      [o.id],
    );
    expect(Number(n)).toBe(1);
    expect(await limitOf(id)).toBe(7);
    expect(await recomputeAuditCount(id)).toBe(1);
    expect((await orders.list(id, 10))[0]).toMatchObject({ status: 'PAID', method: 'BKASH' });
  });

  it('adding a student past the paid entitlement is a 409 SEAT_LIMIT_REACHED', async () => {
    afterCutoff();
    await pay(SEED_TENANT_ID, 2);
    const dto = (name: string) => ({
      full_name: name,
      class_section_id: SEED_SECTION_1_ID,
      preferred_communication: CommunicationMedium.SMS,
    });
    await students.create(dto('A'), SEED_TENANT_ID);
    await students.create(dto('B'), SEED_TENANT_ID);
    await expect(students.create(dto('C'), SEED_TENANT_ID)).rejects.toMatchObject({
      response: { details: { code: 'SEAT_LIMIT_REACHED' } },
    });
  });
});
