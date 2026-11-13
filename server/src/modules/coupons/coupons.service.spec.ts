import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction, CouponDiscountKind, CouponScope } from '@biddaloy/shared';
import { CouponsService } from './coupons.service';
import type { CreateCouponDto } from './dto/coupon.dto';

const ACTOR = { userId: 'u1', ip: null, userAgent: null };
const DTO: CreateCouponDto = {
  code: 'WELCOME10',
  discount_kind: CouponDiscountKind.PERCENT,
  percent: 10,
  starts_at: '2026-12-01T00:00:00.000Z',
  ends_at: '2027-01-01T00:00:00.000Z',
};
const ROW = {
  id: 'c1',
  code: 'WELCOME10',
  discount_kind: CouponDiscountKind.PERCENT,
  percent: 10,
  fixed_paisa: null,
  max_months: null,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: CouponScope.ALL,
  max_uses: null,
  uses_count: 3,
  per_school_max: 1,
  starts_at: new Date(DTO.starts_at),
  ends_at: new Date(DTO.ends_at),
  active: true,
  created_at: new Date(0),
};

/** `answers` maps an SQL prefix to its rows; unlisted statements return []. */
function build(answers: Record<string, unknown[]>) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const key = Object.keys(answers).find((k) => sql.trimStart().startsWith(k));
    return key ? answers[key] : [];
  });
  const m = { query };
  const db = { transaction: (fn: (m: unknown) => unknown) => fn(m), query } as any;
  const audit = { recordApproved: vi.fn() };
  return { svc: new CouponsService(db, audit as any), query, audit };
}

describe('CouponsService.create', () => {
  it('inserts and writes a COUPON_CREATED audit row', async () => {
    const { svc, audit } = build({ 'INSERT INTO coupons': [ROW] });
    expect((await svc.create(DTO, { free: false }, ACTOR)).id).toBe('c1');
    expect(audit.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.COUPON_CREATED }),
      expect.anything(),
    );
  });

  it('refuses percent 100 on the normal route', async () => {
    const { svc, query } = build({});
    const err = await svc.create({ ...DTO, percent: 100 }, { free: false }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details.code).toBe('COUPON_FREE_ROUTE_ONLY');
    expect(query).not.toHaveBeenCalled();
  });

  it('the free route forces PERCENT 100 whatever the body says', async () => {
    const { svc, query } = build({ 'INSERT INTO coupons': [{ ...ROW, percent: 100 }] });
    await svc.create(
      { ...DTO, discount_kind: CouponDiscountKind.FIXED, fixed_paisa: 5 },
      { free: true },
      ACTOR,
    );
    const params = query.mock.calls.find(([s]) =>
      s.includes('INSERT INTO coupons'),
    )![1] as unknown[];
    expect(params.slice(1, 4)).toEqual([CouponDiscountKind.PERCENT, 100, null]);
  });

  it('percent without a value, and a SCHOOLS scope with no schools, are 400', async () => {
    const { svc } = build({});
    await expect(
      svc.create({ ...DTO, percent: undefined }, { free: false }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create({ ...DTO, scope: CouponScope.SCHOOLS }, { free: false }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a replay of the same body on a taken code returns the first coupon', async () => {
    const { svc, audit } = build({ 'SELECT id, code': [ROW] });
    expect((await svc.create(DTO, { free: false }, ACTOR)).id).toBe('c1');
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('a different body on a taken code is 409 COUPON_CODE_TAKEN', async () => {
    const { svc } = build({ 'SELECT id, code': [ROW] });
    const err = await svc.create({ ...DTO, percent: 20 }, { free: false }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('COUPON_CODE_TAKEN');
  });
});

describe('CouponsService.update', () => {
  it('max_uses below the uses so far is a 400 with a fixed code, not the raw constraint', async () => {
    const { svc } = build({ 'SELECT id, code': [ROW] });
    const err = await svc.update('c1', { max_uses: 2 }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details.code).toBe('COUPON_MAX_USES_BELOW_USED');
  });

  it('an unknown id is 404', async () => {
    const { svc } = build({});
    await expect(svc.update('x', { active: false }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('disabling writes COUPON_DISABLED', async () => {
    const { svc, audit } = build({
      'SELECT id, code': [ROW],
      'UPDATE coupons': [[{ ...ROW, active: false }], 1] as unknown[],
    });
    await svc.update('c1', { active: false }, ACTOR);
    expect(audit.recordApproved).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.COUPON_DISABLED }),
      expect.anything(),
    );
  });

  it('a school list on an ALL coupon is 400', async () => {
    const { svc } = build({ 'SELECT id, code': [ROW] });
    await expect(
      svc.update('c1', { schools: ['11111111-1111-4111-8111-111111111111'] }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an end before the start is 400', async () => {
    const { svc } = build({ 'SELECT id, code': [ROW] });
    await expect(
      svc.update('c1', { ends_at: '2026-01-01T00:00:00.000Z' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CouponsService.list / usage', () => {
  it('a forged cursor is a fixed 400', async () => {
    const { svc } = build({});
    await expect(svc.list({ cursor: 'garbage' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.usage('c1', { cursor: 'garbage' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('usage of an unknown coupon is 404', async () => {
    const { svc } = build({});
    await expect(svc.usage('x', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list pages with limit+1 and returns a cursor only when there is more', async () => {
    const ts = '2026-11-01 10:00:00+00';
    const rows = [1, 2, 3].map((i) => ({ ...ROW, id: `id${i}`, ts }));
    const { svc, query } = build({ 'SELECT id, code': rows });
    const page = await svc.list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect((query.mock.calls[0][1] as unknown[])[2]).toBe(3);
    expect((page.items[0] as any).ts).toBeUndefined();
  });
});
