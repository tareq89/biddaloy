import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ReceiptService } from '../../billing/receipt.service';

describe('ReceiptService bundle receipts (integration)', () => {
  let ds: DataSource;
  let svc: ReceiptService;
  const notifyAdmins = vi.fn(async (..._a: unknown[]) => undefined);
  const sfx = () => Math.random().toString(36).slice(2, 10);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(getDataSourceToken());
    svc = new ReceiptService(
      ds,
      { get: (k: string) => (k === 'APP_BASE_URL' ? 'https://app.test' : undefined) } as never,
      { notifyAdmins } as never,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  async function school() {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Rcpt <A>', 'rc-' || $1) RETURNING id`,
      [sfx()],
    );
    return id as string;
  }
  async function order(schoolId: string, status: string, receipt: string | null) {
    const [{ id: catalog }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active) VALUES ($1, 500, 30, 10000, true) RETURNING id`,
      [`Pkg ${sfx()}`],
    );
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key, receipt_number, paid_at)
       VALUES ($1, $2, 'Starter', 500, 30, 10000, $3, $4, $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [schoolId, catalog, status, sfx() + sfx(), receipt],
    );
    await ds.query(
      `INSERT INTO platform_payments (bundle_order_id, method, gateway_ref, amount_paisa) VALUES ($1, 'BKASH', 'TRX42', 10000)`,
      [id],
    );
    return id as string;
  }

  it('a paid (ACTIVE) order renders its numbered receipt, school name escaped', async () => {
    const s = await school();
    const id = await order(s, 'ACTIVE', `SMR-2027-${sfx()}`);
    const html = await svc.renderBundleForSchool(s, id);
    // No stored region: the bn-BD default, so Bangla copy and numerals.
    expect(html).toContain('Starter, ৫০০টি এসএমএস, মেয়াদ ৩০ দিন');
    expect(html).toContain('TRX42');
    expect(html).toContain('Rcpt &lt;A&gt;');
  });

  it('an EXPIRED order keeps its receipt', async () => {
    const s = await school();
    const id = await order(s, 'EXPIRED', `SMR-2027-${sfx()}`);
    await expect(svc.renderBundleForSchool(s, id)).resolves.toContain('SMR-2027-');
  });

  it('an unpaid order is 404', async () => {
    const s = await school();
    const id = await order(s, 'PENDING_PAYMENT', null);
    await expect(svc.renderBundleForSchool(s, id)).rejects.toThrow(NotFoundException);
  });

  it('another school’s order is 404', async () => {
    const a = await school();
    const b = await school();
    const id = await order(a, 'ACTIVE', `SMR-2027-${sfx()}`);
    await expect(svc.renderBundleForSchool(b, id)).rejects.toThrow(NotFoundException);
  });

  it('emailReceipt links a bundle order to the SMS credits page, and never throws', async () => {
    const s = await school();
    const id = await order(s, 'ACTIVE', 'SMR-2027-000001');
    await svc.emailReceipt(id);
    expect(notifyAdmins).toHaveBeenCalledWith(
      s,
      'receipt',
      {
        link: `https://app.test/settings?section=communication&smsOrder=${id}`,
        receipt: 'SMR-2027-000001',
      },
      { emailOnly: true },
    );
    notifyAdmins.mockRejectedValueOnce(new Error('smtp down'));
    await expect(svc.emailReceipt(id)).resolves.toBeUndefined();
  });
});
