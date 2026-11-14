import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PlatformPaymentMethod } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { TenantStatusService } from '../schools/tenant-status.service';
import { StudentService, GuardianService } from '../students/students.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
import { ordersTestDeps } from './orders-test-deps';
import { ReceiptService } from './receipt.service';
import { todayInSchoolTz } from '../../common/time';

/**
 * Safety net [#3847, Epic 100 D1 D5 D27 D28]: today's seat-order pricing, period and receipt
 * rules, frozen with exact numbers. Titles start with `characterization:` so Wave 3 can see
 * which ones it may change on purpose; any other failure there is a regression.
 */
describe('seat order pricing characterization (integration)', () => {
  let ds: DataSource;
  let orders: OrdersService;
  const schoolIds: string[] = [];
  const cash = { method: PlatformPaymentMethod.OFFLINE_CASH };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      OrdersService,
      ...ordersTestDeps(),
      StudentService,
      GuardianService,
      AuditService,
      {
        provide: TenantStatusService,
        useValue: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
      { provide: ReceiptService, useValue: { emailReceipt: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    orders = module.get(OrdersService);
  }, 60000);

  afterEach(async () => {
    for (const id of schoolIds.splice(0)) {
      await ds.query(
        'DELETE FROM platform_payments WHERE seat_order_id IN (SELECT id FROM seat_orders WHERE school_id = $1)',
        [id],
      );
      await ds.query('DELETE FROM seat_orders WHERE school_id = $1', [id]);
    }
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Price ${id.slice(0, 6)}`,
      slug: `price-${id.slice(0, 8)}`,
    });
    schoolIds.push(id);
    return id;
  };
  const pending = (schoolId: string, seats: number, months: number, extra = {}) =>
    orders.createPending({
      schoolId,
      seats,
      months,
      idempotency_key: randomUUID(),
      userId: null,
      ...extra,
    });
  /** today (school time) plus N months, as YYYY-MM-DD, computed by Postgres like the service does. */
  const addMonths = async (date: string, n: number): Promise<string> =>
    (
      await ds.query(`SELECT ($1::date + ($2::int * interval '1 month'))::date::text AS d`, [
        date,
        n,
      ])
    )[0].d;
  const receiptOf = async (orderId: string): Promise<string | null> =>
    (await ds.query('SELECT receipt_number FROM seat_orders WHERE id = $1', [orderId]))[0]
      .receipt_number;
  const rowOf = async (orderId: string) =>
    (
      await ds.query(
        'SELECT period_start::text AS s, period_end::text AS e, status FROM seat_orders WHERE id = $1',
        [orderId],
      )
    )[0] as { s: string; e: string; status: string };

  it('characterization: 50 seats for 3 months price at 1000 paisa per seat-month = 150000', async () => {
    const o = await pending(await newSchool(), 50, 3);
    expect(o.unit_price_paisa).toBe(1000);
    expect(o.amount_paisa).toBe(150000);
  });

  it('characterization: a GRANT (unit price 0) prices at 0', async () => {
    const o = await pending(await newSchool(), 50, 3, { unit_price_paisa: 0 });
    expect(o.unit_price_paisa).toBe(0);
    expect(o.amount_paisa).toBe(0);
  });

  it('characterization: a first order starts today and runs for the months bought', async () => {
    const today = todayInSchoolTz();
    const o = await pending(await newSchool(), 10, 3);
    expect(o.period_start).toBe(today);
    expect(o.period_end).toBe(await addMonths(today, 3));
  });

  it('characterization: a renewal starts where the previous period ends', async () => {
    const today = todayInSchoolTz();
    const id = await newSchool();
    const first = await pending(id, 10, 2);
    await orders.markPaid(first.id, cash);
    const firstEnd = await addMonths(today, 2);
    expect((await rowOf(first.id)).e).toBe(firstEnd);

    const renewal = await pending(id, 10, 1);
    await orders.markPaid(renewal.id, cash);
    expect(await rowOf(renewal.id)).toMatchObject({
      s: firstEnd,
      e: await addMonths(firstEnd, 1),
    });
  });

  it('characterization: an order paid late takes its start at payment time, not creation time', async () => {
    const today = todayInSchoolTz();
    const id = await newSchool();
    const late = await pending(id, 10, 1); // preview start: today
    expect(late.period_start).toBe(today);
    const other = await pending(id, 10, 2);
    await orders.markPaid(other.id, cash); // now covers today .. +2 months
    await orders.markPaid(late.id, cash);
    // Calendar-month addition is not associative: end is one month after the RENEWED start.
    const lateStart = await addMonths(today, 2);
    expect(await rowOf(late.id)).toMatchObject({
      s: lateStart,
      e: await addMonths(lateStart, 1),
    });
  });

  it('characterization: markPaid twice is one payment and the receipt number is set once', async () => {
    const id = await newSchool();
    const o = await pending(id, 5, 1);
    expect(await orders.markPaid(o.id, cash)).toEqual({ applied: true });
    const number = await receiptOf(o.id);
    expect(number).toMatch(/^SMR-\d{4}-\d{6}$/);
    expect(await orders.markPaid(o.id, cash)).toEqual({ applied: false });
    expect(await receiptOf(o.id)).toBe(number);
    const [{ n }] = await ds.query(
      'SELECT count(*)::int AS n FROM platform_payments WHERE seat_order_id = $1',
      [o.id],
    );
    expect(n).toBe(1);
  });

  it('characterization: the next receipt number is max + 1 within the Asia/Dhaka year', async () => {
    const year = todayInSchoolTz().slice(0, 4);
    const id = await newSchool();
    const [{ m }] = await ds.query(
      `SELECT coalesce(max(substring(receipt_number from '[0-9]+$')::bigint), 0) AS m
         FROM seat_orders WHERE receipt_number ~ $1`,
      [`^SMR-${year}-[0-9]{1,15}$`],
    );
    // Plant a known number, so the expectation is exact whatever else is in the database.
    const planted = Number(m) + 40;
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, receipt_number)
       VALUES ($1, 1, 1, 1000, 1000, '2020-01-01', '2020-02-01', 'PAID', 'planted', $2)`,
      [id, `SMR-${year}-${String(planted).padStart(6, '0')}`],
    );
    const o = await pending(id, 1, 1);
    await orders.markPaid(o.id, cash);
    expect(await receiptOf(o.id)).toBe(`SMR-${year}-${String(planted + 1).padStart(6, '0')}`);
  });

  it('characterization: a number from another year does not count, so the series restarts each year', async () => {
    const year = todayInSchoolTz().slice(0, 4);
    const id = await newSchool();
    const [{ m }] = await ds.query(
      `SELECT coalesce(max(substring(receipt_number from '[0-9]+$')::bigint), 0) AS m
         FROM seat_orders WHERE receipt_number ~ $1`,
      [`^SMR-${year}-[0-9]{1,15}$`],
    );
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, receipt_number)
       VALUES ($1, 1, 1, 1000, 1000, '2020-01-01', '2020-02-01', 'PAID', 'last-year', $2)`,
      [id, `SMR-${Number(year) - 1}-999999`],
    );
    const o = await pending(id, 1, 1);
    await orders.markPaid(o.id, cash);
    expect(await receiptOf(o.id)).toBe(`SMR-${year}-${String(Number(m) + 1).padStart(6, '0')}`);
  });

  it('characterization: createPending with the same key returns the same order', async () => {
    const id = await newSchool();
    const key = randomUUID();
    const input = { schoolId: id, seats: 7, months: 2, idempotency_key: key, userId: null };
    const first = await orders.createPending(input);
    const again = await orders.createPending(input);
    expect(again.id).toBe(first.id);
    expect(again.amount_paisa).toBe(14000);
    const [{ n }] = await ds.query(
      'SELECT count(*)::int AS n FROM seat_orders WHERE school_id = $1',
      [id],
    );
    expect(n).toBe(1);
  });

  it('characterization: createPaid prices, pays and numbers in one call; a GRANT gets no receipt', async () => {
    const id = await newSchool();
    const paid = await orders.createPaid(
      { schoolId: id, seats: 20, months: 1, idempotency_key: randomUUID(), userId: null },
      cash,
    );
    expect(paid.amount_paisa).toBe(20000);
    expect((await rowOf(paid.id)).status).toBe('PAID');
    expect(await receiptOf(paid.id)).toMatch(/^SMR-\d{4}-\d{6}$/);

    const grant = await orders.createPaid(
      {
        schoolId: id,
        seats: 5,
        months: 1,
        idempotency_key: randomUUID(),
        userId: null,
        unit_price_paisa: 0,
      },
      { method: PlatformPaymentMethod.GRANT, amount_paisa: '0' },
    );
    expect(grant.amount_paisa).toBe(0);
    expect(await receiptOf(grant.id)).toBeNull();
  });
});
