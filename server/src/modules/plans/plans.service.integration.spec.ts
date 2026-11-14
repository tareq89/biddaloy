import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../audit/audit.service';
import { PlansService } from './plans.service';
import { DEFAULT_PLAN_ID } from './entities/plan.entity';

describe('PlansService (integration)', () => {
  let ds: DataSource;
  let svc: PlansService;
  let user: string;
  const planChanged: string[] = [];
  const sfx = () => Math.random().toString(36).slice(2, 10);
  const newSchool = async () =>
    (
      await ds.query(
        `INSERT INTO schools (id, name, slug) VALUES (gen_random_uuid(), 'Pl', 'pl-' || substr(gen_random_uuid()::text,1,8)) RETURNING id`,
      )
    )[0].id as string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService]);
    ds = module.get(getDataSourceToken());
    svc = new PlansService(ds, module.get(AuditService), {
      planChanged: async (_s: string, name: string) => void planChanged.push(name),
    } as never);
    [{ id: user }] = await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES (gen_random_uuid(), 'pl-' || substr(gen_random_uuid()::text,1,8) || '@example.test', 'x', 'Owner') RETURNING id`,
    );
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const actor = () => ({ userId: user });

  it('a price change reprices priceFor but never an order already created', async () => {
    const plan = await svc.create({ name: `P ${sfx()}`, unit_price_paisa: 1000 }, actor());
    const school = await newSchool();
    await svc.assign(school, { plan_id: plan.id, reason: 'Start on plan' }, actor());
    const [{ id: order }] = await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, 10, 1, 1000, 10000, '2030-01-01', '2030-01-31', 'PAID', $2) RETURNING id`,
      [school, sfx()],
    );
    await svc.update(plan.id, { unit_price_paisa: 2500 }, actor());
    expect((await svc.priceFor(school)).unitPricePaisa).toBe(2500);
    const [o] = await ds.query(`SELECT unit_price_paisa FROM seat_orders WHERE id=$1`, [order]);
    expect(o.unit_price_paisa).toBe(1000); // the order keeps the price it was created at
    await ds.query(`DELETE FROM seat_orders WHERE id=$1`, [order]);
  });

  it('a deactivated plan keeps pricing the school already on it', async () => {
    const plan = await svc.create({ name: `D ${sfx()}`, unit_price_paisa: 700 }, actor());
    const school = await newSchool();
    await svc.assign(school, { plan_id: plan.id, reason: 'Start on plan' }, actor());
    await svc.update(plan.id, { active: false }, actor());
    expect((await svc.priceFor(school)).unitPricePaisa).toBe(700);
    const err = await svc
      .assign(school, { plan_id: plan.id, reason: 'Again please' }, actor())
      .catch((e) => e);
    // Same plan on a school is checked after availability: an off plan is not available.
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('PLAN_NOT_AVAILABLE');
  });

  it('the default plan cannot be deactivated and a duplicate name is a fixed 409', async () => {
    const err = await svc.update(DEFAULT_PLAN_ID, { active: false }, actor()).catch((e) => e);
    expect(err.getResponse().code).toBe('PLAN_IS_DEFAULT');
    const name = `Dup ${sfx()}`;
    await svc.create({ name, unit_price_paisa: 1 }, actor());
    const dup = await svc
      .create({ name: name.toUpperCase(), unit_price_paisa: 1 }, actor())
      .catch((e) => e);
    expect(dup.getResponse().code).toBe('PLAN_NAME_TAKEN');
    expect(JSON.stringify(dup.getResponse())).not.toContain(name);
  });

  it('two concurrent make-default calls leave exactly one default', async () => {
    const a = await svc.create({ name: `A ${sfx()}`, unit_price_paisa: 1 }, actor());
    const b = await svc.create({ name: `B ${sfx()}`, unit_price_paisa: 1 }, actor());
    // Deterministic latch: this transaction holds every plan row, so both calls block on the
    // same lock until we see two waiters, then release. No sleeps, only a wait on a condition.
    const holder = ds.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query(`SELECT id FROM plans ORDER BY id FOR UPDATE`);
    const calls = Promise.all([svc.makeDefault(a.id, actor()), svc.makeDefault(b.id, actor())]);
    for (;;) {
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM plans ORDER BY id FOR UPDATE%' AND pid <> pg_backend_pid()`,
      );
      if (n >= 2) break;
      await new Promise((r) => setImmediate(r));
    }
    await holder.commitTransaction();
    await holder.release();
    await calls;
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM plans WHERE is_default`);
    expect(n).toBe(1);
  });

  it('assign: no-op on the same plan, audit carries old, new and reason, notice after commit', async () => {
    const plan = await svc.create({ name: `M ${sfx()}`, unit_price_paisa: 900 }, actor());
    const school = await newSchool();
    const before = planChanged.length;
    await svc.assign(school, { plan_id: plan.id, reason: 'Agreed deal' }, actor());
    await svc.assign(school, { plan_id: plan.id, reason: 'Agreed deal' }, actor()); // no-op
    expect(planChanged.length).toBe(before + 1);
    const logs = await ds.query(
      `SELECT old_values, new_values FROM audit_logs WHERE entity_id=$1 AND action='PLAN_ASSIGNED'`,
      [school],
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].old_values.plan_id).toBe(DEFAULT_PLAN_ID);
    expect(logs[0].new_values.plan_id).toBe(plan.id);
    expect(logs[0].new_values.reason).toBe('Agreed deal');
  });
});
