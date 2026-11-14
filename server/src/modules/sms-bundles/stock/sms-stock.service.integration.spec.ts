import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SmsStockService } from './sms-stock.service';

describe('SmsStockService (integration)', () => {
  let ds: DataSource;
  let svc: SmsStockService;
  let user: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService]);
    ds = module.get(getDataSourceToken());
    svc = new SmsStockService(ds, module.get(AuditService), { id: async () => undefined } as never);
    [{ id: user }] = await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES (gen_random_uuid(), 'stock-' || substr(gen_random_uuid()::text,1,8) || '@example.test', 'x', 'Owner') RETURNING id`,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('record stores whole paisa and audits SMS_STOCK_RECORDED', async () => {
    const e = await svc.record(
      { boughtOn: '2026-11-01', smsCount: 1000, costTaka: 12.34 },
      { userId: user },
    );
    expect(e.costPaisa).toBe('1234');
    const logs = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'SMS_STOCK_RECORDED'`,
      [e.id],
    );
    expect(logs).toHaveLength(1);
  });

  it('delete is soft, audits the reason, hides the row from list, second delete is 404', async () => {
    const e = await svc.record(
      { boughtOn: '2026-11-01', smsCount: 10, costTaka: 1 },
      { userId: user },
    );
    await svc.remove(e.id, 'entered twice by mistake', { userId: user });
    const [row] = await ds.query(
      `SELECT deleted_at, delete_reason, deleted_by_user_id FROM sms_stock_entries WHERE id = $1`,
      [e.id],
    );
    expect(row.deleted_at).not.toBeNull(); // soft delete: the row stays
    expect(row.delete_reason).toBe('entered twice by mistake');
    expect(row.deleted_by_user_id).toBe(user);
    const [log] = await ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'SMS_STOCK_DELETED'`,
      [e.id],
    );
    expect(log.new_values.reason).toBe('entered twice by mistake');
    const page = await svc.list(100);
    expect(page.items.find((i) => i.id === e.id)).toBeUndefined();
    await expect(svc.remove(e.id, 'again please', { userId: user })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('weighted average excludes deleted rows and rounds half up', async () => {
    await ds.query(`UPDATE sms_stock_entries SET deleted_at = now() WHERE deleted_at IS NULL`);
    const a = await svc.record(
      { boughtOn: '2026-11-01', smsCount: 2, costTaka: 0.05 },
      { userId: user },
    ); // 5 paisa / 2 sms = 2.5 -> 3
    expect(await svc.weightedAverageCostPaisaPerSms()).toBe(3);
    const b = await svc.record(
      { boughtOn: '2026-11-01', smsCount: 1000, costTaka: 500 },
      { userId: user },
    );
    await svc.remove(b.id, 'wrong supplier entry', { userId: user });
    expect(await svc.weightedAverageCostPaisaPerSms()).toBe(3);
    await svc.remove(a.id, 'wrong supplier entry', { userId: user });
    expect(await svc.weightedAverageCostPaisaPerSms()).toBeNull();
  });
});
