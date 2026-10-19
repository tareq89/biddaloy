import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../src/modules/audit/audit.service';
import { AcademicYearService } from '../src/modules/academics/academic-year.service';
import { ClassService, SectionService } from '../src/modules/classes/classes.service';
import { SubjectService } from '../src/modules/academics/subjects.service';
import { RoomsService } from '../src/modules/routines/rooms.service';
import { GradingService } from '../src/modules/grading/grading.service';
import { SchoolSettingsReader } from '../src/modules/schools/settings/school-settings-reader.service';
import { SchoolsService } from '../src/modules/schools/schools.service';
import { ALLOWED, Ctx, GUARDED, KNOWN_GAPS, PARENTS } from './delete-guard-registry';

const PARENT_NAMES = [
  'AcademicYear',
  'Class',
  'ClassSection',
  'Subject',
  'Room',
  'GradingScale',
  'FeeStructure',
];

/**
 * [2655] Delete-guard registry. Runs on the migrated DB, in its own school with
 * uniquely numbered names (nothing is dropped; the test DB is dropped per run).
 */
describe('delete-guard registry (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let ctx: Ctx;
  let seq = 0;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      AcademicYearService,
      ClassService,
      SectionService,
      SubjectService,
      RoomsService,
      GradingService,
      AuditService,
      SchoolSettingsReader,
      { provide: SchoolsService, useValue: {} },
    ]);
    ds = module.get(DataSource);
    const tenantId = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      tenantId,
      'Guard Registry School',
      `guard-registry-${tenantId.slice(0, 8)}`,
    ]);
    ctx = {
      ds,
      tenantId,
      n: () => ++seq,
      svc: {
        academicYears: module.get(AcademicYearService),
        classes: module.get(ClassService),
        sections: module.get(SectionService),
        subjects: module.get(SubjectService),
        rooms: module.get(RoomsService),
        grading: module.get(GradingService),
      },
    };
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  describe('coverage', () => {
    // Every many-to-one that points at a protected parent, as "Child.prop -> Parent".
    const relations = () =>
      ds.entityMetadatas.flatMap((meta) =>
        meta.manyToOneRelations
          .filter((r) => PARENT_NAMES.includes(r.inverseEntityMetadata.name))
          .map((r) => `${meta.name}.${r.propertyName} -> ${r.inverseEntityMetadata.name}`),
      );
    const listed = () => [
      ...GUARDED.map((e) => e.key),
      ...ALLOWED.map((e) => e.key),
      ...KNOWN_GAPS.map((e) => e.key),
    ];

    it('puts every relation to a protected parent in exactly one list', () => {
      const inList = listed();
      const missing = relations().filter((k) => !inList.includes(k));
      // Fix: add the key to GUARDED, ALLOWED or KNOWN_GAPS in server/test/delete-guard-registry.ts.
      expect(missing, 'add it to GUARDED, ALLOWED or KNOWN_GAPS').toEqual([]);

      const dupes = inList.filter((k, i) => inList.indexOf(k) !== i);
      expect(dupes, 'a relation is in more than one list').toEqual([]);
    });

    it('lists no relation that no longer exists (stale entry)', () => {
      const real = relations();
      expect(
        listed().filter((k) => !real.includes(k)),
        'stale registry entries',
      ).toEqual([]);
    });

    it('gives every ALLOWED and KNOWN_GAPS entry a reason and every gap a follow-up', () => {
      for (const e of [...ALLOWED, ...KNOWN_GAPS])
        expect(e.reason.length, e.key).toBeGreaterThan(10);
      for (const e of KNOWN_GAPS) expect(e.followUp, e.key).toBeTruthy();
    });
  });

  describe('GUARDED: parent remove() is a 409 while a live child exists', () => {
    it.each(GUARDED.map((g) => [g.key, g] as const))('%s', async (_key, g) => {
      const parent = PARENTS[g.parent];
      const parentId = await parent.make(ctx);
      const child = await g.makeChild(ctx, parentId);

      await expect(parent.remove(ctx, parentId)).rejects.toBeInstanceOf(ConflictException);
      expect(await parent.isGone(ctx, parentId), 'parent must stay').toBe(false);

      // With the child gone (soft-deleted, or deleted where the table has no soft delete) the remove works.
      await child.release();
      await parent.remove(ctx, parentId);
      expect(await parent.isGone(ctx, parentId)).toBe(true);
    });
  });
});
