import { describe, it, expect, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { nextRollNumber, ROLL_NUMBER_LOCK_NAMESPACE } from './roll-number.util';

/**
 * Unit tests for the shared roll-number util — [8.11.3] extracted this out
 * of `StudentService.create` so `EnrollmentService`'s "move class" sync
 * could reuse the exact same advisory-lock pattern. Real locking/
 * concurrency behaviour is exercised against a real database by
 * `students.service.integration.spec.ts` (create) and
 * `enrollments.service.integration.spec.ts` (move) — this file only
 * covers the pure "what does it compute, what does it lock" contract with
 * a mocked `EntityManager`, so it doesn't need a DB connection.
 */
describe('nextRollNumber', () => {
  function buildManager(lastRoll: { roll_number: number } | null) {
    const query = vi.fn().mockResolvedValue(undefined);
    const findOne = vi.fn().mockResolvedValue(lastRoll);
    const manager = {
      query,
      getRepository: vi.fn().mockReturnValue({ findOne }),
    } as unknown as EntityManager;
    return { manager, query, findOne };
  }

  it('acquires the advisory lock keyed on the section id before reading', async () => {
    const { manager, query } = buildManager(null);

    await nextRollNumber(manager, 'section-1', 'tenant-1');

    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [
      'section-1',
      ROLL_NUMBER_LOCK_NAMESPACE,
    ]);
  });

  it('returns 1 when the section has no students yet', async () => {
    const { manager } = buildManager(null);

    const result = await nextRollNumber(manager, 'section-1', 'tenant-1');

    expect(result).toBe(1);
  });

  it("returns the last student's roll_number + 1 when the section already has students", async () => {
    const { manager } = buildManager({ roll_number: 7 });

    const result = await nextRollNumber(manager, 'section-1', 'tenant-1');

    expect(result).toBe(8);
  });

  it('passes withDeleted: true so a soft-deleted top roll is skipped', async () => {
    const { manager, findOne } = buildManager({ roll_number: 7 });

    await nextRollNumber(manager, 'section-1', 'tenant-1');

    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ withDeleted: true }));
  });

  it('scopes the lookup to the given section and tenant, counting soft-deleted students (no deleted_at filter)', async () => {
    const { manager, findOne } = buildManager(null);

    await nextRollNumber(manager, 'section-1', 'tenant-1');

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          class_section_id: 'section-1',
          tenant_id: 'tenant-1',
        }),
        order: { roll_number: 'DESC' },
      }),
    );
    // No `deleted_at` filter: the unique index counts soft-deleted rows too.
    const whereArg = findOne.mock.calls[0][0].where;
    expect('deleted_at' in whereArg).toBe(false);
  });
});
