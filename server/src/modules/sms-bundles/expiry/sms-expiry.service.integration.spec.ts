import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeMeteredCreditService } from '@test/helpers/sms-credit-ledger.helper';
import { SmsExpiryService } from './sms-expiry.service';

// School-local date for this instant is 2027-03-10 (Asia/Dhaka, +06:00).
const now = new Date('2027-03-10T06:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe('SmsExpiryService (integration)', () => {
  let ds: DataSource;
  let svc: SmsExpiryService;
  const notifyAdmins = vi.fn();
  const schools: string[] = [];
  let catalogId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    const config = { get: () => undefined } as never;
    svc = new SmsExpiryService(ds, config, makeMeteredCreditService(ds), { notifyAdmins } as never);
  }, 60000);

  afterAll(async () => {
    if (ds) {
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    notifyAdmins.mockReset().mockResolvedValue(undefined);
    [{ id: catalogId }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa)
       VALUES ('Expiry test ' || substr(gen_random_uuid()::text,1,8), 1000, 30, 1000) RETURNING id`,
    );
  });

  afterEach(async () => {
    for (const id of schools.splice(0)) {
      await ds.query(`DELETE FROM sms_credit_ledger WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_credit_lot_draws WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_credit_lots WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [id]);
      await ds.query(`DELETE FROM sms_bundle_orders WHERE school_id = $1`, [id]);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [id]);
    }
    await ds.query(`DELETE FROM sms_bundle_catalog WHERE id = $1`, [catalogId]);
  });

  const school = async (): Promise<string> => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Exp', 'exp-' || substr(gen_random_uuid()::text,1,8)) RETURNING id`,
    );
    schools.push(id);
    return id;
  };

  /** A bundle order with its lot; `balanceAvailable` mirrors what the lots hold. */
  const bundle = async (
    tenant: string,
    o: { remaining: number; reserved?: number; debited?: number; expiresAt: Date; status?: string },
  ) => {
    const reserved = o.reserved ?? 0;
    const debited = o.debited ?? 0;
    const total = o.remaining + reserved + debited;
    const [{ id: orderId }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1,$2,'P',$3,30,1000,$4,gen_random_uuid()::text) RETURNING id`,
      [tenant, catalogId, total, o.status ?? 'ACTIVE'],
    );
    const [{ id: lotId }] = await ds.query(
      `INSERT INTO sms_credit_lots (tenant_id, source, bundle_order_id, units_total, remaining, reserved_units, debited_units, expires_at, status)
       VALUES ($1,'BUNDLE',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        tenant,
        orderId,
        total,
        o.remaining,
        reserved,
        debited,
        o.expiresAt,
        o.remaining + reserved === 0 ? 'USED_UP' : 'ACTIVE',
      ],
    );
    await ds.query(
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET available = sms_credit_balance.available + $2, reserved = sms_credit_balance.reserved + $3`,
      [tenant, o.remaining, reserved],
    );
    return { orderId, lotId };
  };

  const orderStatus = async (id: string) =>
    (await ds.query(`SELECT status FROM sms_bundle_orders WHERE id = $1`, [id]))[0].status;
  const expireRows = async (t: string) =>
    (
      await ds.query(
        `SELECT count(*)::int AS n FROM sms_credit_ledger WHERE tenant_id = $1 AND kind = 'EXPIRE'`,
        [t],
      )
    )[0].n;

  it('expires units once, marks order EXPIRED, and a second run does nothing', async () => {
    const t = await school();
    const { orderId } = await bundle(t, { remaining: 40, debited: 60, expiresAt: at(-1) });
    const first = await svc.run(now);
    // Global sweep: other specs' rows may be closed in the same run.
    expect(first.ordersClosed).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(orderId)).toBe('EXPIRED');
    expect(await expireRows(t)).toBe(1);
    const second = await svc.run(now);
    expect(second).toMatchObject({ expiredLots: 0, ordersClosed: 0 });
    expect(await expireRows(t)).toBe(1);
  });

  it('an order whose units were all used becomes USED_UP', async () => {
    const t = await school();
    const { orderId } = await bundle(t, { remaining: 0, debited: 100, expiresAt: at(-1) });
    await svc.run(now);
    expect(await orderStatus(orderId)).toBe('USED_UP');
  });

  it('reserved units survive an expiring lot and the order waits', async () => {
    const t = await school();
    const { orderId, lotId } = await bundle(t, { remaining: 30, reserved: 20, expiresAt: at(-1) });
    await svc.run(now);
    const [lot] = await ds.query(
      `SELECT remaining, reserved_units, status FROM sms_credit_lots WHERE id = $1`,
      [lotId],
    );
    expect(lot).toMatchObject({ remaining: 0, reserved_units: 20, status: 'ACTIVE' });
    expect(await orderStatus(orderId)).toBe('ACTIVE');
  });

  it('an already CANCELLED order is never overwritten', async () => {
    const t = await school();
    const { orderId } = await bundle(t, {
      remaining: 0,
      debited: 10,
      expiresAt: at(-1),
      status: 'REFUNDED',
    });
    await svc.run(now);
    expect(await orderStatus(orderId)).toBe('REFUNDED');
  });

  it('notices: 7 and 1 day lots once per lot; none for 0 remaining or other days', async () => {
    const t = await school();
    const d7 = await bundle(t, { remaining: 50, expiresAt: at(7) });
    const d1 = await bundle(t, { remaining: 20, expiresAt: at(1) });
    await bundle(t, { remaining: 0, debited: 10, expiresAt: at(7) });
    await bundle(t, { remaining: 10, expiresAt: at(3) });
    await svc.run(now);
    await svc.run(now);
    const keys = notifyAdmins.mock.calls.map((c) => c[1]).sort();
    expect(keys).toEqual(['sms_expiring_d1', 'sms_expiring_d7']);
    const call = notifyAdmins.mock.calls.find((c) => c[1] === 'sms_expiring_d7')!;
    expect(call[2]).toMatchObject({ units: 50, date: '2027-03-17' });
    expect(call[3]).toEqual({ emailOnly: true });
    expect(d7.lotId).not.toBe(d1.lotId);
  });

  it('a school failing does not stop the next school', async () => {
    const a = await school();
    const b = await school();
    await bundle(a, { remaining: 5, expiresAt: at(1) });
    await bundle(b, { remaining: 5, expiresAt: at(1) });
    notifyAdmins.mockRejectedValueOnce(new Error('smtp down'));
    const r = await svc.run(now);
    expect(r.noticesFailed).toBe(1);
    expect(r.noticesSent).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledTimes(2);
  });
});
