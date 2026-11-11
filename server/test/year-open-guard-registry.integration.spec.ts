import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { YEAR_SCOPED_WRITES } from '../src/common/utils/year-open.guard';

/**
 * [69.1.04] Year-open registry. A new entity with an `academic_year_id` column fails here until
 * it is listed in `YEAR_SCOPED_WRITES` and its service calls the guard.
 * Same shape as delete-guard-registry.integration.spec.ts.
 */

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

  describe('(b) every listed service calls the guard', () => {
    // Behaviour (409, nothing written) is proven per service in its own integration spec;
    // this fails when a listed service file has no guard call at all.
    const srcDir = join(__dirname, '../src');
    const sources = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !/\.(spec|e2e-spec)\.ts$/.test(f))
      .map((f) => readFileSync(join(srcDir, f), 'utf8'));

    for (const entry of YEAR_SCOPED_WRITES) {
      it(`${entry.entity}: ${entry.service} calls assertYearOpen / assertDateNotInClosedYear`, () => {
        const src = sources.find((t) => new RegExp(`export class ${entry.service}\\b`).test(t));
        expect(src, `no file declares ${entry.service}`).toBeDefined();
        expect(src).toMatch(/assertYearOpen\(|assertDateNotInClosedYear\(/);
      });
    }
  });
});
