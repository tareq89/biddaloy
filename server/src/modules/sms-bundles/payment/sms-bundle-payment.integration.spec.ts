import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PlatformPaymentMethod } from '@biddaloy/shared';
import { SmsCreditBalance } from '../../communications/credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from '../../communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { SmsBundleOrderSweepService } from '../orders/sms-bundle-order-sweep.service';
import { SmsBundlePaymentService } from './sms-bundle-payment.service';

describe('SmsBundlePaymentService (integration)', () => {
  let ds: DataSource;
  let credits: SmsCreditService;
  let svc: SmsBundlePaymentService;
  let failPurchase = false;
  let vatSetting = {
    rate_bp: null as number | null,
    label: 'VAT',
    registration: null as string | null,
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    const real = new SmsCreditService(
      module.get(getRepositoryToken(SmsCreditBalance)),
      module.get(getRepositoryToken(SmsCreditLedger)),
      ds,
      { getResolvedSettings: async () => ({}) } as never,
    );
    credits = {
      purchase: (...a: Parameters<SmsCreditService['purchase']>) => {
        if (failPurchase) throw new Error('boom');
        return real.purchase(...a);
      },
    } as never;
    svc = new SmsBundlePaymentService(
      ds,
      credits,
      { isOversold: async () => false } as never,
      { emailReceipt: async () => undefined } as never,
      { get: async () => vatSetting } as never,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const sfx = () => Math.random().toString(36).slice(2, 10);
  async function order(status = 'PENDING_PAYMENT') {
    const [{ id: school }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Pay', 'pay-' || $1) RETURNING id`,
      [sfx()],
    );
    const [{ id: catalog }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active) VALUES ($1, 500, 30, 10000, true) RETURNING id`,
      [`Pkg ${sfx()}`],
    );
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1, $2, 'Pkg', 500, 30, 10000, $3, $4) RETURNING id`,
      [school, catalog, status, sfx() + sfx()],
    );
    return { id: id as string, school: school as string };
  }
  const pay = (id: string, ref = `TRX${sfx()}`) =>
    svc.markPaid(id, { method: PlatformPaymentMethod.BKASH, gateway_ref: ref });
  const facts = async (id: string) => {
    const one = async (sql: string) => Number((await ds.query(sql, [id]))[0].n);
    const [o] = await ds.query(
      `SELECT status, receipt_number FROM sms_bundle_orders WHERE id = $1`,
      [id],
    );
    return {
      ...o,
      payments: await one(
        `SELECT count(*)::int n FROM platform_payments WHERE bundle_order_id = $1`,
      ),
      lots: await one(`SELECT count(*)::int n FROM sms_credit_lots WHERE bundle_order_id = $1`),
    };
  };

  it('pays once: ACTIVE, one payment, one lot, a receipt number; a replay changes nothing', async () => {
    const { id, school } = await order();
    expect(await pay(id)).toEqual({ applied: true });
    expect(await pay(id)).toEqual({ applied: false });
    const f = await facts(id);
    expect(f).toMatchObject({ status: 'ACTIVE', payments: 1, lots: 1 });
    expect(f.receipt_number).toMatch(/^SMR-\d{4}-\d{6}$/);
    const [{ available }] = await ds.query(
      `SELECT available FROM sms_credit_balance WHERE tenant_id = $1`,
      [school],
    );
    expect(Number(available)).toBe(500);
  });

  it('freezes the VAT in the receipt snapshot: a later rate change leaves it alone', async () => {
    vatSetting = { rate_bp: 1500, label: 'VAT', registration: 'BIN-7' };
    const { id } = await order();
    await pay(id);
    vatSetting = { rate_bp: 500, label: 'GST', registration: null };
    const [{ receipt_snapshot: snap }] = await ds.query(
      `SELECT receipt_snapshot FROM sms_bundle_orders WHERE id = $1`,
      [id],
    );
    expect(snap.vat).toEqual({
      registration: 'BIN-7',
      rate_bp: 1500,
      label: 'VAT',
      vat_paisa: 1305,
      net_paisa: 8695,
    });
    vatSetting = { rate_bp: null, label: 'VAT', registration: null };
  });

  it('callback and reconciler at once: one payment, one lot, one receipt number', async () => {
    const { id } = await order();
    // Same trx from both paths; the order row lock lets exactly one apply.
    const results = await Promise.all([pay(id, 'SAMETRX1'), pay(id, 'SAMETRX1')]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await facts(id)).toMatchObject({ status: 'ACTIVE', payments: 1, lots: 1 });
  });

  it('a failed purchase rolls the whole payment back', async () => {
    const { id } = await order();
    failPurchase = true;
    try {
      await expect(pay(id)).rejects.toThrow('boom');
    } finally {
      failPurchase = false;
    }
    expect(await facts(id)).toMatchObject({
      status: 'PENDING_PAYMENT',
      payments: 0,
      lots: 0,
      receipt_number: null,
    });
  });

  it('a cancelled order is never paid (late callback keeps the money as an orphan, elsewhere)', async () => {
    const { id } = await order('CANCELLED');
    expect(await pay(id)).toEqual({ applied: false });
    expect(await facts(id)).toMatchObject({ status: 'CANCELLED', payments: 0, lots: 0 });
  });

  it('the sweep leaves a stale order alone when a payment row links it', async () => {
    const paid = await order();
    await ds.query(
      `INSERT INTO platform_payments (bundle_order_id, method, gateway_ref, amount_paisa, raw)
       VALUES ($1, 'BKASH', $2, 10000, '{"orphan":true}')`,
      [paid.id, `ORPH${sfx()}`],
    );
    const free = await order();
    await ds.query(
      `UPDATE sms_bundle_orders SET created_at = now() - interval '25 hours' WHERE id = ANY($1)`,
      [[paid.id, free.id]],
    );
    const sweep = new SmsBundleOrderSweepService(ds, {
      paymentMayBeLive: async () => false,
    } as never);
    await sweep.cancelStale();
    expect((await facts(paid.id)).status).toBe('PENDING_PAYMENT');
    expect((await facts(free.id)).status).toBe('CANCELLED');
  });
});
