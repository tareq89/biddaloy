import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlansService } from './plans.service';

const actor = { userId: 'owner-1' };

/** A service whose transaction runs on a fake manager serving one plan row. */
const build = (row: object | null, extra: Record<string, unknown> = {}) => {
  const repo = {
    findOne: vi.fn().mockResolvedValue(row),
    save: vi.fn(async (r) => r),
    update: vi.fn(),
  };
  const m = { getRepository: () => repo, query: vi.fn().mockResolvedValue([]) };
  const ds = { transaction: (fn: (m: unknown) => unknown) => fn(m), query: vi.fn(), ...extra };
  const audit = { recordApproved: vi.fn(), record: vi.fn() };
  const notices = { planChanged: vi.fn() };
  return { svc: new PlansService(ds as never, audit as never, notices as never), repo, audit };
};

describe('PlansService rules', () => {
  it('the default plan cannot be deactivated: 409 PLAN_IS_DEFAULT, nothing saved', async () => {
    const { svc, repo, audit } = build({
      id: 'p',
      name: 'Std',
      unit_price_paisa: 1,
      active: true,
      is_default: true,
    });
    const err = await svc.update('p', { active: false }, actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().code).toBe('PLAN_IS_DEFAULT');
    expect(repo.save).not.toHaveBeenCalled();
    expect(audit.recordApproved).not.toHaveBeenCalled();
  });

  it('an inactive plan cannot become the default', async () => {
    const { svc, repo } = build({
      id: 'p',
      name: 'Old',
      unit_price_paisa: 1,
      active: false,
      is_default: false,
    });
    const err = await svc.makeDefault('p', actor).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('unknown plan is 404', async () => {
    const { svc } = build(null);
    await expect(svc.makeDefault('p', actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('priceFor returns whole-paisa integers', async () => {
    const q = vi.fn().mockResolvedValue([{ id: 'p', name: 'Std', unit_price_paisa: 1250 }]);
    const { svc } = build(null, { query: q });
    const r = await svc.priceFor('school-1');
    expect(r).toEqual({ planId: 'p', name: 'Std', unitPricePaisa: 1250 });
    expect(Number.isInteger(r.unitPricePaisa)).toBe(true);
  });
});
