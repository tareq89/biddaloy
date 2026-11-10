import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { GradingService } from './grading.service';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

// [69.1.08] copyScalesToYear against a real database. Own tenant + unique ids,
// so nothing depends on another spec's rows.
describe('GradingService.copyScalesToYear (integration)', () => {
  let service: GradingService;
  let ds: DataSource;

  const TENANT = randomUUID();
  const SRC_YEAR = randomUUID();
  const TGT_YEAR = randomUUID();
  const CLS = [randomUUID(), randomUUID(), randomUUID()]; // source classes
  const TGT_CLS = [randomUUID(), randomUUID()]; // target classes for CLS[0], CLS[1]

  const classMap = () =>
    new Map([
      [CLS[0], TGT_CLS[0]],
      [CLS[1], TGT_CLS[1]],
    ]);
  const run = (dryRun: boolean, map = classMap()) =>
    ds.transaction((m) => service.copyScalesToYear(m, TENANT, SRC_YEAR, TGT_YEAR, map, dryRun));

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [GradingService, AuditService]);
    service = module.get(GradingService);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  // The test setup empties the tables before every test, so seed per test.
  beforeEach(async () => {
    await ds
      .getRepository(School)
      .save({ id: TENANT, name: 'Grading School', slug: `g-${TENANT}` });
    const years = ds.getRepository(AcademicYear);
    await years.save([
      {
        id: SRC_YEAR,
        name: '2026',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT,
      },
      {
        id: TGT_YEAR,
        name: '2027',
        start_date: new Date('2027-01-01'),
        end_date: new Date('2027-12-31'),
        is_current: false,
        tenant_id: TENANT,
      },
    ]);
    await ds.getRepository(Class).save([
      { id: CLS[0], name: 'One', academic_year_id: SRC_YEAR, tenant_id: TENANT },
      { id: CLS[1], name: 'Two', academic_year_id: SRC_YEAR, tenant_id: TENANT },
      { id: CLS[2], name: 'Three', academic_year_id: SRC_YEAR, tenant_id: TENANT },
      { id: TGT_CLS[0], name: 'One', academic_year_id: TGT_YEAR, tenant_id: TENANT },
      { id: TGT_CLS[1], name: 'Two', academic_year_id: TGT_YEAR, tenant_id: TENANT },
    ]);

    // Default + two overrides, each with two bands.
    const scales = ds.getRepository(GradingScale);
    const bands = ds.getRepository(GradingBand);
    for (const [name, classId] of [
      ['Default', null],
      ['Override One', CLS[0]],
      ['Override Two', CLS[1]],
    ] as const) {
      const scale = await scales.save({
        tenant_id: TENANT,
        academic_year_id: SRC_YEAR,
        class_id: classId,
        name,
      });
      await bands.save([
        {
          tenant_id: TENANT,
          scale_id: scale.id,
          percent_from: 50,
          percent_to: 100,
          grade: 'P',
          gpa: 4,
          is_fail: false,
          sequence: 1,
          comment: null,
        },
        {
          tenant_id: TENANT,
          scale_id: scale.id,
          percent_from: 0,
          percent_to: 49,
          grade: 'F',
          gpa: 0,
          is_fail: true,
          sequence: 2,
          comment: null,
        },
      ]);
    }
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('dryRun counts three but writes nothing', async () => {
    expect(await run(true)).toEqual({ created: 3, existing: 0, skipped: [] });
    expect(await ds.getRepository(GradingScale).countBy({ academic_year_id: TGT_YEAR })).toBe(0);
  });

  it('copies default + 2 overrides with bands, then re-run reports existing 3', async () => {
    expect(await run(false)).toEqual({ created: 3, existing: 0, skipped: [] });

    const copied = await ds.getRepository(GradingScale).findBy({ academic_year_id: TGT_YEAR });
    expect(copied.map((c) => c.class_id).sort()).toEqual([null, ...TGT_CLS].sort());
    for (const scale of copied) {
      expect(await ds.getRepository(GradingBand).countBy({ scale_id: scale.id })).toBe(2);
    }

    expect(await run(false)).toEqual({ created: 0, existing: 3, skipped: [] });
  });

  it('leaves an existing target scale untouched even when its bands differ', async () => {
    await run(false);
    const scale = await ds.getRepository(GradingScale).findOneByOrFail({
      academic_year_id: TGT_YEAR,
      name: 'Default',
    });
    await ds.getRepository(GradingBand).update({ scale_id: scale.id, sequence: 1 }, { grade: 'X' });
    await run(false);
    const band = await ds
      .getRepository(GradingBand)
      .findOneByOrFail({ scale_id: scale.id, sequence: 1 });
    expect(band.grade).toBe('X');
  });

  it('skips an override whose class is not mapped, naming it', async () => {
    await ds.getRepository(GradingScale).save({
      tenant_id: TENANT,
      academic_year_id: SRC_YEAR,
      class_id: CLS[2],
      name: 'Override Three',
    });
    const res = await run(false);
    expect(res.skipped).toEqual([{ name: 'Override Three', reason: 'CLASS_NOT_COPIED' }]);
    expect(res.created).toBe(3); // the three mapped scales still copy
  });
});
