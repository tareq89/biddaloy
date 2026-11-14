import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SmsBundleOrdersService } from './sms-bundle-orders.service';
import { SmsBundleOrderSweepService } from './sms-bundle-order-sweep.service';

describe('SmsBundleOrdersService (integration)', () => {
  let ds: DataSource;
  let svc: SmsBundleOrdersService;
  let sweep: SmsBundleOrderSweepService;
  let user: string;
  let oversold = false;
  const sfx = () => Math.random().toString(36).slice(2, 10);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService]);
    ds = module.get(getDataSourceToken());
    const allocation = {
      isOversold: async () => oversold,
      weightedAverageCostPaisaPerSms: async () => 12.5,
    };
    svc = new SmsBundleOrdersService(ds, allocation as never, module.get(AuditService));
    sweep = new SmsBundleOrderSweepService(ds, { paymentMayBeLive: async () => false } as never);
    [{ id: user }] = await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES (gen_random_uuid(), 'ord-' || substr(gen_random_uuid()::text,1,8) || '@example.test', 'x', 'Admin') RETURNING id`,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const school = async (source: 'PLATFORM' | 'OFF' = 'PLATFORM') => {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug, settings) VALUES (gen_random_uuid(), 'Ord', 'ord-' || substr(gen_random_uuid()::text,1,8), $1::jsonb) RETURNING id`,
      [JSON.stringify({ communications: { sms: { metering: source } } })],
    );
    return id as string;
  };
  const pkg = async (active = true, price = 10000) => {
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active) VALUES ($1, 500, 30, $2, $3) RETURNING id`,
      [`Pkg ${sfx()}`, price, active],
    );
    return id as string;
  };
  const buy = (schoolId: string, packageId: string, key = randomUUID()) =>
    svc.create({ schoolId, userId: user, packageId, idempotencyKey: key });
  const count = async (schoolId: string) =>
    Number(
      (
        await ds.query(`SELECT count(*)::int AS n FROM sms_bundle_orders WHERE school_id=$1`, [
          schoolId,
        ])
      )[0].n,
    );

  it('same key twice gives one row, the first price stays, and one audit row', async () => {
    oversold = false;
    const s = await school();
    const p = await pkg();
    const key = randomUUID();
    const a = await buy(s, p, key);
    await ds.query(`UPDATE sms_bundle_catalog SET price_paisa = 99999 WHERE id=$1`, [p]);
    const b = await buy(s, p, key); // replay: first order, untouched
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({
      status: 'PENDING_PAYMENT',
      pricePaisa: '10000',
      costPaisaPerSms: '12.5000',
    });
    expect(await count(s)).toBe(1);
    const logs = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='SMS_BUNDLE_ORDERED'`,
      [a.id],
    );
    expect(logs).toHaveLength(1);
  });

  it('the same key with another package is 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const s = await school();
    const key = randomUUID();
    await buy(s, await pkg(), key);
    await expect(buy(s, await pkg(), key)).rejects.toBeInstanceOf(ConflictException);
  });

  it('two concurrent creates with different keys give two orders', async () => {
    const s = await school();
    const p = await pkg();
    await Promise.all([buy(s, p), buy(s, p)]);
    expect(await count(s)).toBe(2);
  });

  it('two concurrent creates with the same key give one order', async () => {
    const s = await school();
    const p = await pkg();
    const key = randomUUID();
    const [a, b] = await Promise.all([buy(s, p, key), buy(s, p, key)]);
    expect(a.id).toBe(b.id);
    expect(await count(s)).toBe(1);
  });

  it('an oversold platform refuses with 409 SMS_SALES_PAUSED and inserts nothing', async () => {
    const s = await school();
    const p = await pkg();
    oversold = true;
    try {
      await expect(buy(s, p)).rejects.toMatchObject({
        response: { details: { code: 'SMS_SALES_PAUSED' } },
      });
    } finally {
      oversold = false;
    }
    expect(await count(s)).toBe(0);
  });

  it('a school on its OWN source, an off package and an unknown package are refused', async () => {
    oversold = false;
    const own = await school('OFF');
    await expect(buy(own, await pkg())).rejects.toMatchObject({
      response: { details: { code: 'SMS_SOURCE_NOT_PLATFORM' } },
    });
    const s = await school();
    await expect(buy(s, await pkg(false))).rejects.toThrow('not available');
    await expect(buy(s, randomUUID())).rejects.toThrow('not available');
    expect(await count(own)).toBe(0);
    expect(await count(s)).toBe(0);
  });

  it('school A cannot read school B’s order and lists none of it', async () => {
    const a = await school();
    const b = await school();
    const order = await buy(b, await pkg());
    await expect(svc.get(a, order.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await svc.list(a)).toEqual([]);
    expect((await svc.get(b, order.id)).id).toBe(order.id);
  });

  it('stale sweep cancels only unpaid rows older than 24 h', async () => {
    const s = await school();
    const old = await buy(s, await pkg());
    const fresh = await buy(s, await pkg());
    const oldPaid = await buy(s, await pkg());
    await ds.query(
      `UPDATE sms_bundle_orders SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`,
      [[old.id, oldPaid.id]],
    );
    await ds.query(`UPDATE sms_bundle_orders SET status='PAID' WHERE id=$1`, [oldPaid.id]);
    await sweep.cancelStale();
    expect((await svc.get(s, old.id)).status).toBe('CANCELLED');
    expect((await svc.get(s, fresh.id)).status).toBe('PENDING_PAYMENT');
    expect((await svc.get(s, oldPaid.id)).status).toBe('PAID');
  });
});
