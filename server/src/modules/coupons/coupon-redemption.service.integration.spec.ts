import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { CouponRedemptionService, type RedeemInput } from './coupon-redemption.service';

// Needs Postgres: the last-use guarantee is one SQL statement plus a lock, so it is tested for real.
describe('CouponRedemptionService (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let svc: CouponRedemptionService;
  const tag = randomUUID().slice(0, 8);

  // The limiter and audit are not under test here; the engine is.
  const limiter = { assertAllowed: async () => undefined, recordFailure: async () => undefined };
  const audit = { record: async () => undefined };

  async function addSchool(): Promise<string> {
    const id = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      id,
      'Coupon Test School',
      `coupon-${tag}-${id.slice(0, 8)}`,
    ]);
    return id;
  }

  async function addCoupon(opts: {
    code: string;
    maxUses?: number | null;
    usesCount?: number;
    perSchoolMax?: number;
    scope?: 'ALL' | 'SCHOOLS';
    schools?: string[];
  }): Promise<string> {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO coupons (id, code, discount_kind, fixed_paisa, scope, max_uses, uses_count,
          per_school_max, starts_at, ends_at)
       VALUES ($1, $2, 'FIXED', 100, $3, $4, $5, $6, now() - interval '1 day', now() + interval '1 day')`,
      [
        id,
        `${opts.code}-${tag}`.toUpperCase(),
        opts.scope ?? 'ALL',
        opts.maxUses ?? null,
        opts.usesCount ?? 0,
        opts.perSchoolMax ?? 1,
      ],
    );
    for (const s of opts.schools ?? []) {
      await ds.query(`INSERT INTO coupon_schools (coupon_id, school_id) VALUES ($1, $2)`, [id, s]);
    }
    return id;
  }

  /** 1 seat x 1 month x 1000 paisa, FIXED 100 off => discount 100, amount 900. */
  async function addOrder(m: EntityManager, schoolId: string): Promise<string> {
    const id = randomUUID();
    await m.query(
      `INSERT INTO seat_orders (id, school_id, seats, months, unit_price_paisa, amount_paisa,
          discount_paisa, period_start, period_end, status, idempotency_key)
       VALUES ($1, $2, 1, 1, 1000, 900, 100, '2031-01-01', '2031-01-31', 'FAILED', $3)`,
      [id, schoolId, randomUUID()],
    );
    return id;
  }

  const input = (schoolId: string, code: string): Omit<RedeemInput, 'seatOrderId'> => ({
    schoolId,
    code: `${code}-${tag}`,
    seats: 1,
    months: 1,
    unitPaisa: 1000,
    discountPaisa: 100,
  });

  /** Order + redemption in one transaction, like the real caller. */
  const redeemWithOrder = (schoolId: string, code: string) =>
    ds.transaction(async (m) => {
      const seatOrderId = await addOrder(m, schoolId);
      return svc.redeemInTx(m, { ...input(schoolId, code), seatOrderId });
    });

  const usesOf = async (couponId: string) =>
    Number(
      (await ds.query(`SELECT uses_count FROM coupons WHERE id = $1`, [couponId]))[0].uses_count,
    );
  const redemptionsOf = async (couponId: string) =>
    Number(
      (
        await ds.query(`SELECT count(*) AS n FROM coupon_redemptions WHERE coupon_id = $1`, [
          couponId,
        ])
      )[0].n,
    );

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    svc = new CouponRedemptionService(ds, limiter as any, audit as any);
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  it('20 redemptions racing for the 1 remaining use give exactly one winner', async () => {
    const couponId = await addCoupon({ code: 'LASTUSE', maxUses: 5, usesCount: 4 });
    const schools = await Promise.all(Array.from({ length: 20 }, addSchool));

    // Latch: every racer is built and waiting, then one call releases them together.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const racers = schools.map((s) => gate.then(() => redeemWithOrder(s, 'LASTUSE')));
    release();
    const results = await Promise.allSettled(racers);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);
    // Every loser reads the same generic sentence.
    for (const l of lost) {
      expect(l.reason.getResponse().details.code).toBe('COUPON_NOT_VALID');
    }
    expect(await usesOf(couponId)).toBe(5);
    expect(await redemptionsOf(couponId)).toBe(1);
  }, 60000);

  it('the per-school cap holds when one school races itself', async () => {
    const couponId = await addCoupon({ code: 'ONEEACH', perSchoolMax: 1 });
    const school = await addSchool();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const racers = Array.from({ length: 6 }, () =>
      gate.then(() => redeemWithOrder(school, 'ONEEACH')),
    );
    release();
    const results = await Promise.allSettled(racers);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // Rolled-back losers must not leave a use behind.
    expect(await usesOf(couponId)).toBe(1);
    expect(await redemptionsOf(couponId)).toBe(1);
  }, 60000);

  it('a SCHOOLS coupon refuses another school with the same answer as an unknown code', async () => {
    const mine = await addSchool();
    const other = await addSchool();
    await addCoupon({ code: 'ONLYMINE', scope: 'SCHOOLS', schools: [mine] });

    const wrongSchool = await redeemWithOrder(other, 'ONLYMINE').catch((e) => e);
    const unknown = await redeemWithOrder(other, 'NOSUCHCODE').catch((e) => e);
    expect(wrongSchool.getResponse()).toEqual(unknown.getResponse());
    expect(wrongSchool.getResponse().details.code).toBe('COUPON_NOT_VALID');

    await expect(redeemWithOrder(mine, 'ONLYMINE')).resolves.toMatchObject({ discountPaisa: 100 });
  });

  it('a rollback after the use was taken leaves uses_count unchanged', async () => {
    const couponId = await addCoupon({ code: 'ROLLBACK' });
    const school = await addSchool();
    await expect(
      ds.transaction(async (m) => {
        const seatOrderId = await addOrder(m, school);
        await svc.redeemInTx(m, { ...input(school, 'ROLLBACK'), seatOrderId });
        throw new Error('order failed later');
      }),
    ).rejects.toThrow('order failed later');
    expect(await usesOf(couponId)).toBe(0);
    expect(await redemptionsOf(couponId)).toBe(0);

    // An order that does not exist fails the FK after the use was taken: also nothing kept.
    await expect(
      ds.transaction((m) =>
        svc.redeemInTx(m, { ...input(school, 'ROLLBACK'), seatOrderId: randomUUID() }),
      ),
    ).rejects.toThrow();
    expect(await usesOf(couponId)).toBe(0);
  });
});
