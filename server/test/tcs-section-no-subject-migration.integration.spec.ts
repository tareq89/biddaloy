import { describe, expect, it, vi } from 'vitest';
import { AddTcsSectionNoSubjectUniqueIndex1790400000000 } from '../src/migrations/1790400000000-AddTcsSectionNoSubjectUniqueIndex';

/** [pr-fix #1035] Locks in the migration's duplicate-detection guard: it
 * must abort rather than create the index blind (or silently delete real
 * `teacher_class_sections` rows — attendance/homework/marks access grants).
 * Uses a fake `QueryRunner` rather than a real DB — the guard is pure
 * SQL-in/throw-out logic.
 *
 * Lives in `test/`, not next to the migration: `src/data-source.ts` and
 * `test/global-setup.ts` load every `src/migrations/*.{ts,js}` file as a
 * migration, so a spec there would be `require()`d (and its `vitest`
 * import executed) by `migration:run` and by every test run's global
 * setup. Same placement as `sms-credit-ledger-migration.integration.spec.ts`. */
describe('AddTcsSectionNoSubjectUniqueIndex1790400000000', () => {
  it('aborts without creating the index when duplicate class-teacher rows exist', async () => {
    const migration = new AddTcsSectionNoSubjectUniqueIndex1790400000000();
    const query = vi.fn().mockResolvedValueOnce([{ section_id: 'section-1', n: 2 }]);
    const queryRunner = { query } as unknown as import('typeorm').QueryRunner;

    await expect(migration.up(queryRunner)).rejects.toThrow(/section-1/);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/HAVING COUNT\(\*\) > 1/);
  });

  it('creates the index when no duplicates exist', async () => {
    const migration = new AddTcsSectionNoSubjectUniqueIndex1790400000000();
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
    const queryRunner = { query } as unknown as import('typeorm').QueryRunner;

    await migration.up(queryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toMatch(/CREATE UNIQUE INDEX "UQ_tcs_section_no_subject"/);
  });
});
