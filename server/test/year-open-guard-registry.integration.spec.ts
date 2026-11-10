import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { YEAR_SCOPED_WRITES } from '../src/common/utils/year-open.guard';

/**
 * [69.1.04] Year-open registry. A new entity with an `academic_year_id` column fails here until
 * it is listed in `YEAR_SCOPED_WRITES` (and so, in the end, wired to `assertYearOpen`).
 * Same shape as delete-guard-registry.integration.spec.ts.
 */

// Part (b): how to call each wired entry's methods against a closed year. An entry that is
// `wired: true` with no entry here fails; #3526-#3532 add theirs as they flip `wired`.
const CLOSED_YEAR_CALLS: Record<string, () => Promise<void>> = {};

// Entities with no `academic_year_id` column that the registry lists anyway (guarded by date).
const DATE_KEYED = ['AttendanceRecord'];

describe('year-open guard registry (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  describe('(a) coverage', () => {
    it('lists every entity that has an academic_year_id column', () => {
      const withYear = ds.entityMetadatas
        .filter((meta) => meta.columns.some((c) => c.propertyName === 'academic_year_id'))
        .map((meta) => meta.name);
      const listed = YEAR_SCOPED_WRITES.map((e) => e.entity);
      const missing = withYear.filter((name) => !listed.includes(name));
      // Fix: add the entity to YEAR_SCOPED_WRITES in server/src/common/utils/year-open.guard.ts.
      expect(missing, 'entity with academic_year_id missing from YEAR_SCOPED_WRITES').toEqual([]);
    });

    it('lists no entity that no longer exists (stale entry)', () => {
      const real = ds.entityMetadatas.map((meta) => meta.name);
      const stale = YEAR_SCOPED_WRITES.map((e) => e.entity).filter((n) => !real.includes(n));
      expect(stale, 'stale YEAR_SCOPED_WRITES entries').toEqual([]);
    });

    it('lists each entity once, and every entry names its write methods', () => {
      const names = YEAR_SCOPED_WRITES.map((e) => e.entity);
      expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
      expect(YEAR_SCOPED_WRITES.filter((e) => e.methods.length === 0)).toEqual([]);
      expect(DATE_KEYED.every((n) => names.includes(n))).toBe(true);
    });
  });

  describe('(b) wired entries refuse a closed year', () => {
    it('has a closed-year call for every wired entry', () => {
      const wired = YEAR_SCOPED_WRITES.filter((e) => e.wired);
      const uncovered = wired.filter((e) => !CLOSED_YEAR_CALLS[e.entity]).map((e) => e.entity);
      expect(uncovered, 'wired entry without a CLOSED_YEAR_CALLS entry').toEqual([]);
    });

    for (const entry of YEAR_SCOPED_WRITES) {
      // Unwired entries are reported as skipped, not failed, until their ticket wires them.
      it.skipIf(!entry.wired)(`${entry.entity}: ${entry.methods.join(', ')} -> 409`, async () => {
        await expect(CLOSED_YEAR_CALLS[entry.entity]()).rejects.toMatchObject({
          response: { details: { code: 'ACADEMIC_YEAR_CLOSED' } },
        });
      });
    }
  });

  // (c) Attendance is keyed by date: its CLOSED_YEAR_CALLS entry must use a date inside the
  // closed year (see assertDateNotInClosedYear). Wired by the attendance guard ticket.
});
