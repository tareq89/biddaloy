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
    await pay(id, 5, 3); // overlaps the first one
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
    expect(await limitOf(id)).toBe(15);
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
    const b = await orders.createPending({ ...input, seats: 99 });
    expect(b.id).toBe(a.id);
    expect(a.amount_paisa).toBe(12000);
    expect(a.status).toBe('PENDING');
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
