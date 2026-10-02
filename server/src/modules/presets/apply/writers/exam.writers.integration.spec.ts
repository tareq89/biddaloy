import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeTestPack } from '../../__fixtures__/test-pack';
import type { ApplyContext } from '../apply-context';
import { School } from '../../../schools/entities/school.entity';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { GradingBand } from '../../../grading/entities/grading-band.entity';
import { AcademicTerm } from '../../../calendar/entities/academic-term.entity';
import { ExamTemplate } from '../../../exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../../../exams/entities/exam-template-component.entity';
import { writeYear } from './year.writer';
import { writeClasses } from './classes.writer';
import { writeSubjects } from './subjects.writer';
import { writeGradingScale } from './grading-scale.writer';
import { writeTerms } from './terms.writer';
import { writeExamTemplates } from './exam-templates.writer';

describe('exam preset writers (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  async function run(opts: {
    startMonth?: number;
    stages: string[];
    mutate?: (p: ReturnType<typeof makeTestPack>) => void;
  }) {
    const pack = makeTestPack();
    pack.yearShape.startMonth = opts.startMonth ?? 1;
    opts.mutate?.(pack);
    const tenantId = randomUUID();
    await ds.getRepository(School).save({
      id: tenantId,
      name: 'Exam Writers School',
      slug: `exam-writers-${tenantId}`,
    });
    const counts: Record<string, number> = {};
    await ds.transaction(async (manager) => {
      const ctx: ApplyContext = {
        manager,
        tenantId,
        userId: randomUUID(),
        pack,
        options: { presetId: pack.id, startYear: 2026, stages: opts.stages, versions: [] },
        ids: {
          classIdByKey: new Map(),
          subjectIdByCode: new Map(),
          classSubjectIdByKey: new Map(),
        },
      };
      for (const w of [
        writeYear,
        writeClasses,
        writeSubjects,
        writeGradingScale,
        writeTerms,
        writeExamTemplates,
      ])
        Object.assign(counts, await w(ctx));
    });
    return { tenantId, counts };
  }

  it('creates the default scale and bands, preserving is_fail', async () => {
    const { tenantId, counts } = await run({ stages: ['PRIMARY'] });
    expect(counts).toMatchObject({ grading_scales: 1, grading_bands: 3 });
    const scale = await ds.getRepository(GradingScale).findOneByOrFail({ tenant_id: tenantId });
    expect(scale.class_id).toBeNull();
    expect(scale.revision).toBe(1);
    const bands = await ds
      .getRepository(GradingBand)
      .find({ where: { tenant_id: tenantId }, order: { sequence: 'ASC' } });
    expect(bands.map((b) => [b.grade, b.is_fail, b.gpa])).toEqual([
      ['F', true, '0.00'],
      ['B', false, '3.00'],
      ['A+', false, '5.00'],
    ]);
  });

  it('gradingScale null creates none', async () => {
    const { tenantId, counts } = await run({
      stages: ['PRIMARY'],
      mutate: (p) => (p.gradingScale = null),
    });
    expect(counts.grading_scales).toBeUndefined();
    expect(await ds.getRepository(GradingScale).countBy({ tenant_id: tenantId })).toBe(0);
  });

  it.each([
    [1, '2026-01-01', '2026-06-30'],
    [7, '2027-01-01', '2027-06-30'], // Jan < July start month -> following calendar year
  ])('startMonth %i places the term at %s..%s', async (startMonth, start, end) => {
    const { tenantId } = await run({ startMonth, stages: ['PRIMARY'] });
    const t = await ds.getRepository(AcademicTerm).findOneByOrFail({ tenant_id: tenantId });
    expect([String(t.start_date), String(t.end_date)]).toEqual([start, end]);
  });

  it('rejects overlapping terms', async () => {
    await expect(
      run({
        stages: ['PRIMARY'],
        mutate: (p) =>
          p.terms.push({
            name: 'T2',
            seq: 2,
            start: { month: 6, day: 1 },
            end: { month: 9, day: 1 },
          }),
      }),
    ).rejects.toThrow(/overlap/);
  });

  it('keeps rows of selected stages only and drops a template left empty', async () => {
    const { tenantId, counts } = await run({
      stages: ['PRIMARY'],
      mutate: (p) => {
        p.examTemplates[0].rows.push({
          classGrade: 9,
          subjectCode: 'MAT',
          components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33 }],
        });
        p.examTemplates.push({
          name: 'Secondary only',
          kind: 'TERM',
          rows: [
            {
              classGrade: 9,
              subjectCode: 'MAT',
              components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33 }],
            },
          ],
        });
      },
    });
    expect(counts).toMatchObject({ exam_templates: 1, exam_template_components: 1 });
    expect(await ds.getRepository(ExamTemplate).countBy({ tenant_id: tenantId })).toBe(1);
    const comps = await ds.getRepository(ExamTemplateComponent).findBy({ tenant_id: tenantId });
    expect(comps.map((c) => [c.class_grade, c.subject_code, c.sequence])).toEqual([[1, 'BAN', 0]]);
  });
});
