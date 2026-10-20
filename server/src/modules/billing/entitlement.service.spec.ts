import { describe, it, expect, vi, afterEach } from 'vitest';
import { EntitlementService } from './entitlement.service';

const FREE_UNTIL = '2027-01-01T00:00:00+06:00';

describe('EntitlementService', () => {
  const original = process.env.BILLING_FREE_UNTIL;
  afterEach(() => {
    if (original === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = original;
  });

  const build = () => {
    const audit = { record: vi.fn() };
    const tenantStatus = { invalidate: vi.fn() };
    const service = new EntitlementService({} as never, audit as never, tenantStatus as never);
    return { service, audit, tenantStatus };
  };

  it('limitFor is null (unlimited) before the cutoff and never touches the database', async () => {
    process.env.BILLING_FREE_UNTIL = FREE_UNTIL;
    const manager = { query: vi.fn() };
    const { service } = build();
    expect(
      await service.limitFor(manager as never, 's1', new Date('2026-12-31T00:00:00Z')),
    ).toBeNull();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('limitFor at the cutoff instant is the paid sum (0 with no order)', async () => {
    process.env.BILLING_FREE_UNTIL = FREE_UNTIL;
    const manager = { query: vi.fn().mockResolvedValue([{ n: 0 }]) };
    const { service } = build();
    // 2027-01-01T00:00+06:00 is the first moment billing applies.
    expect(await service.limitFor(manager as never, 's1', new Date(FREE_UNTIL))).toBe(0);
  });

  it('recompute writes and audits when the limit changed', async () => {
    process.env.BILLING_FREE_UNTIL = FREE_UNTIL;
    const manager = {
      query: vi
        .fn()
        .mockResolvedValueOnce([{ seat_limit: null }]) // lock + read school
        .mockResolvedValueOnce([{ n: 12 }]) // paid seats
        .mockResolvedValueOnce(undefined), // UPDATE
    };
    const { service, audit } = build();
    const res = await service.recompute('s1', manager as never, new Date('2027-02-01T00:00:00Z'));
    expect(res).toEqual({ changed: true, limit: 12 });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('recompute is silent when the limit is already right', async () => {
    process.env.BILLING_FREE_UNTIL = FREE_UNTIL;
    const manager = {
      query: vi
        .fn()
        .mockResolvedValueOnce([{ seat_limit: 12 }])
        .mockResolvedValueOnce([{ n: 12 }]),
    };
    const { service, audit } = build();
    const res = await service.recompute('s1', manager as never, new Date('2027-02-01T00:00:00Z'));
    expect(res.changed).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledTimes(2); // no UPDATE
  });
});
