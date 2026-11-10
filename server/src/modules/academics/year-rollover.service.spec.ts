import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { YearRolloverService } from './year-rollover.service';

/** Unit checks with a stubbed manager; the database behaviour is in the integration spec. */
function build(findOne: ReturnType<typeof vi.fn>) {
  const manager: any = {
    getRepository: () => ({ findOne }),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    insert: vi.fn(),
  };
  const fees = { copyStructuresToYear: vi.fn() };
  const grading = { copyScalesToYear: vi.fn() };
  const terms = { copyTermsToYear: vi.fn() };
  const service = new YearRolloverService(
    { manager, transaction: (cb: any) => cb(manager) } as any,
    fees as any,
    grading as any,
    terms as any,
    { record: vi.fn() } as any,
  );
  return { service, manager, fees, grading, terms };
}

const input = { name: 'N', start_date: '2028-01-01', end_date: '2028-12-31' };

describe('YearRolloverService', () => {
  it('404s when the source year is not in the tenant', async () => {
    const { service } = build(vi.fn().mockResolvedValue(null));
    await expect(service.preview('t', 's', { ...input, include: [] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('skips blocks that are not in include and writes nothing in a preview', async () => {
    const source = { id: 's' };
    const findOne = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    const { service, manager, fees, grading, terms } = build(findOne);
    const res = await service.preview('t', 's', { ...input, include: ['fee_structures'] });
    expect(res.target_year_id).toBeNull();
    expect(res.classes).toBeUndefined();
    expect(res.terms).toBeUndefined();
    expect(fees.copyStructuresToYear).toHaveBeenCalledOnce();
    expect(fees.copyStructuresToYear.mock.calls[0][6]).toBe(true); // dryRun
    expect(grading.copyScalesToYear).not.toHaveBeenCalled();
    expect(terms.copyTermsToYear).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.insert).not.toHaveBeenCalled();
  });
});
