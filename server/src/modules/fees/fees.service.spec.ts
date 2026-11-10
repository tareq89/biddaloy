import { describe, it, expect, vi } from 'vitest';
import { FeeStructureService } from './fees.service';

// [69.1.07] Natural-key matching + dryRun, against a fake EntityManager.
const row = (o: Record<string, unknown>) => ({
  fee_type: 'MONTHLY_TUITION',
  amount: 10,
  class_id: null,
  section_id: null,
  ...o,
});

function run(sources: any[], targets: any[], dryRun: boolean, classes = new Map<string, string>()) {
  const insert = vi.fn();
  const manager: any = {
    find: vi.fn(async (_e: unknown, opts: any) =>
      opts.where.academic_year_id === 'src' ? sources : targets,
    ),
    create: vi.fn((_e: unknown, v: unknown) => v),
    insert,
  };
  const service = new FeeStructureService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  return service
    .copyStructuresToYear(manager, 't', 'src', 'tgt', classes, new Map([['s1', 's2']]), dryRun)
    .then((r) => ({ r, insert }));
}

describe('FeeStructureService.copyStructuresToYear', () => {
  it('matches null class/section as null and class by mapped id', async () => {
    const classes = new Map([['c1', 'c2']]);
    const { r, insert } = await run(
      [
        row({ name: 'A' }),
        row({ name: 'B', class_id: 'c1' }),
        row({ name: 'C', class_id: 'c1', section_id: 's1' }),
      ],
      [row({ name: 'A' }), row({ name: 'B', class_id: 'c2' })],
      false,
      classes,
    );
    expect(r).toEqual({ created: 1, existing: 2, skipped: [] });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('dryRun writes nothing', async () => {
    const { r, insert } = await run([row({ name: 'A' })], [], true);
    expect(r.created).toBe(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips an unmapped class', async () => {
    const { r } = await run([row({ name: 'A', class_id: 'zz' })], [], false);
    expect(r.skipped).toEqual([{ name: 'A', reason: 'CLASS_NOT_COPIED' }]);
  });
});
