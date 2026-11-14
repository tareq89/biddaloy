import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { SmsBundleCatalogService } from './sms-bundle-catalog.service';

describe('SmsBundleCatalogService (integration)', () => {
  let ds: DataSource;
  let svc: SmsBundleCatalogService;
  let user: string;
  const sfx = () => Math.random().toString(36).slice(2, 10);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService]);
    ds = module.get(getDataSourceToken());
    svc = new SmsBundleCatalogService(ds, module.get(AuditService), {
      id: async () => undefined,
    } as never);
    [{ id: user }] = await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES (gen_random_uuid(), 'cat-' || substr(gen_random_uuid()::text,1,8) || '@example.test', 'x', 'Owner') RETURNING id`,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const input = (name: string) => ({ name, smsCount: 500, validityDays: 30, priceTaka: 100 });

  it('editing the price leaves an already-bought order unchanged, and audits old/new', async () => {
    const pkg = await svc.create(input(`Pkg ${sfx()}`), { userId: user });
    const [{ id: school }] = await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Cat', 'cat-' || substr(gen_random_uuid()::text,1,8)) RETURNING id`,
    );
    const [{ id: order }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa, status, idempotency_key)
       VALUES ($1, $2, $3, 500, 30, 10000, 'PAID', $4) RETURNING id`,
      [school, pkg.id, pkg.name, sfx()],
    );
    await svc.update(pkg.id, { priceTaka: 250.5 }, { userId: user });
    const [o] = await ds.query(`SELECT price_paisa::text AS p FROM sms_bundle_orders WHERE id=$1`, [
      order,
    ]);
    expect(o.p).toBe('10000'); // the order keeps the price it was bought at
    const [c] = await ds.query(
      `SELECT price_paisa::text AS p FROM sms_bundle_catalog WHERE id=$1`,
      [pkg.id],
    );
    expect(c.p).toBe('25050');
    const [log] = await ds.query(
      `SELECT old_values, new_values FROM audit_logs WHERE entity_id=$1 AND action='SMS_BUNDLE_UPDATED'`,
      [pkg.id],
    );
    expect(log.old_values.price_paisa).toBe('10000');
    expect(log.new_values.price_paisa).toBe('25050');
    await ds.query(`DELETE FROM sms_bundle_orders WHERE id=$1`, [order]);
    await ds.query(`DELETE FROM schools WHERE id=$1`, [school]);
  });

  it('listActive hides off rows, cheapest first; toggle is idempotent and audited once', async () => {
    const a = await svc.create(input(`A ${sfx()}`), { userId: user });
    const b = await svc.create({ ...input(`B ${sfx()}`), priceTaka: 1 }, { userId: user });
    await svc.setActive(a.id, false, { userId: user });
    await svc.setActive(a.id, false, { userId: user });
    const ids = (await svc.listActive()).map((p) => p.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
    expect((await svc.listAll(100)).map((p) => p.id)).toContain(a.id);
    const logs = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id=$1 AND action='SMS_BUNDLE_TOGGLED'`,
      [a.id],
    );
    expect(logs).toHaveLength(1);
    const prices = (await svc.listActive()).map((p) => BigInt(p.pricePaisa));
    expect(prices).toEqual([...prices].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it('a second active package with the same name is a fixed 409 that does not echo the name', async () => {
    const name = `Dup ${sfx()}`;
    await svc.create(input(name), { userId: user });
    const err = await svc.create(input(name.toUpperCase()), { userId: user }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(JSON.stringify(err.getResponse())).not.toContain(name);
  });
});
