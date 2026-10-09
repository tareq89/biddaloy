import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { ExamsService } from './exams.service';
import { ExamTemplatesService } from './exam-templates.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplateComponent } from './entities/exam-template-component.entity';
import { Mark } from './entities/mark.entity';
import { CreateExamDto } from './dto/exams.dto';
import { Subject } from '../academics/entities/subject.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000e0001';
const YEAR_ID = '00000000-0000-4000-8000-0000000e0011';
const CLASS_9_ID = '00000000-0000-4000-8000-0000000e0021';
const CLASS_NOGRADE_ID = '00000000-0000-4000-8000-0000000e0022';

describe('ExamsService.create with template_id (integration)', () => {
  let service: ExamsService;
  let templates: ExamTemplatesService;
  let ds: DataSource;
  let audit: { record: ReturnType<typeof vi.fn> };
  let ban: Subject;
  let eng: Subject;

  beforeAll(async () => {
    audit = { record: vi.fn(async () => undefined) };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ExamsService,
        ExamTemplatesService,
        { provide: AuditService, useValue: audit },
        ...[Exam, Mark, Class, AcademicYear, AcademicTerm].map((e) => ({
          provide: getRepositoryToken(e),
          useFactory: (d: DataSource) => d.getRepository(e),
          inject: [DataSource],
        })),
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(ExamsService);
    templates = module.get(ExamTemplatesService);
    ds = module.get(DataSource);
    const schools = ds.getRepository(School);
    for (const id of [SEED_TENANT_ID, OTHER_TENANT_ID]) {
      await schools.save(schools.create({ id, name: id, slug: id, tenant_id: id }));
    }
    await ds.getRepository(AcademicYear).save({
      id: YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    } as any);
    await ds.getRepository(Class).save([
      {
        id: CLASS_9_ID,
        name: 'Nine',
        numeric_grade: 9,
        academic_year_id: YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      },
      {
        id: CLASS_NOGRADE_ID,
        name: 'Nursery',
        academic_year_id: YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      },
    ] as any);
  }, 120_000);

  // test/setup.ts truncates subjects/class_subjects/exams/templates before every test.
  beforeEach(async () => {
    audit.record.mockClear();
    const subjects = ds.getRepository(Subject);
    ban = await subjects.save(
      subjects.create({ tenant_id: SEED_TENANT_ID, code: 'BAN', name_en: 'Bangla' } as any),
    );
    eng = await subjects.save(
      subjects.create({ tenant_id: SEED_TENANT_ID, code: 'ENG', name_en: 'English' } as any),
    );
    await ds.getRepository(ClassSubject).save([
      {
        tenant_id: SEED_TENANT_ID,
        class_id: CLASS_9_ID,
        subject_id: ban.id,
        academic_year_id: YEAR_ID,
      },
      {
        tenant_id: SEED_TENANT_ID,
        class_id: CLASS_9_ID,
        subject_id: eng.id,
        academic_year_id: YEAR_ID,
      },
    ] as any);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const dto = (over: Partial<CreateExamDto> = {}): CreateExamDto => ({
    name: 'Mid',
    kind: ExamKind.TERM,
    academic_year_id: YEAR_ID,
    class_id: CLASS_9_ID,
    ...over,
  });

  async function makeTemplate(tenantId = SEED_TENANT_ID, codes = ['BAN', 'ENG']) {
    const t = await ds
      .getRepository(ExamTemplate)
      .save({ tenant_id: tenantId, name: `T-${Math.random()}`, kind: ExamKind.TERM } as any);
    const rows: any[] = [];
    for (const code of codes) {
      rows.push(
        {
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          full_marks: '37.50',
          pass_marks: '12.25',
          sequence: 1,
        },
        {
          name: 'MCQ',
          kind: ExamComponentKind.MCQ,
          full_marks: '25.00',
          pass_marks: '8.00',
          sequence: 2,
        },
      );
      rows
        .slice(-2)
        .forEach((r) =>
          Object.assign(r, {
            tenant_id: tenantId,
            template_id: t.id,
            class_grade: 9,
            subject_code: code,
          }),
        );
    }
    await ds.getRepository(ExamTemplateComponent).save(rows);
    return t;
  }

  const examCount = () => ds.getRepository(Exam).count();
  const compCount = () => ds.getRepository(ExamComponent).count();

  it('happy path: copies components with exact string marks and sequences', async () => {
    const t = await makeTemplate();
    const res = await service.create(dto({ template_id: t.id }), SEED_TENANT_ID);
    expect(res.components_created).toBe(4);
    const comps = await ds
      .getRepository(ExamComponent)
      .find({ where: { exam_id: res.id }, order: { subject_id: 'ASC', sequence: 'ASC' } });
    expect(comps).toHaveLength(4);
    const written = comps.find((c) => c.name === 'Written' && c.subject_id === ban.id)!;
    expect(written).toMatchObject({
      full_marks: '37.50',
      pass_marks: '12.25',
      sequence: 1,
      source: ExamComponentSource.MANUAL,
      tenant_id: SEED_TENANT_ID,
    });
    const rec = audit.record.mock.calls[0][0];
    expect(rec.new_values).toMatchObject({ template_id: t.id, components_created: 4 });
  });

  it('skips subjects the class does not offer; zero matches still creates the exam', async () => {
    const t = await makeTemplate(SEED_TENANT_ID, ['BAN', 'PHY']);
    const res = await service.create(dto({ template_id: t.id }), SEED_TENANT_ID);
    expect(res.components_created).toBe(2);
    const t2 = await makeTemplate(SEED_TENANT_ID, ['PHY']);
    const res2 = await service.create(dto({ name: 'Zero', template_id: t2.id }), SEED_TENANT_ID);
    expect(res2.components_created).toBe(0);
    expect(await examCount()).toBe(2);
  });

  it('unknown, foreign-tenant and soft-deleted templates are 404 and leave no exam', async () => {
    const foreign = await makeTemplate(OTHER_TENANT_ID);
    const deleted = await makeTemplate();
    await ds.getRepository(ExamTemplate).softDelete({ id: deleted.id });
    for (const id of ['00000000-0000-4000-8000-00000000ffff', foreign.id, deleted.id]) {
      await expect(service.create(dto({ template_id: id }), SEED_TENANT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
    expect(await examCount()).toBe(0);
  });

  it('class without numeric_grade is 400 and leaves no exam', async () => {
    const t = await makeTemplate();
    await expect(
      service.create(dto({ class_id: CLASS_NOGRADE_ID, template_id: t.id }), SEED_TENANT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await examCount()).toBe(0);
  });

  it('a failing component insert rolls back the exam too', async () => {
    const t = await makeTemplate();
    const real = templates.componentsFor.bind(templates);
    const spy = vi.spyOn(templates, 'componentsFor').mockImplementation(async (...a) => {
      const rows = await real(...a);
      return [rows[0], { ...rows[0] }] as any; // duplicate (subject, name) -> unique violation
    });
    await expect(service.create(dto({ template_id: t.id }), SEED_TENANT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    spy.mockRestore();
    expect(await examCount()).toBe(0);
    expect(await compCount()).toBe(0);
  });

  it('ATTENDANCE template rows are copied as DERIVED', async () => {
    const t = await ds
      .getRepository(ExamTemplate)
      .save({ tenant_id: SEED_TENANT_ID, name: 'Att', kind: ExamKind.TERM } as any);
    await ds.getRepository(ExamTemplateComponent).save({
      tenant_id: SEED_TENANT_ID,
      template_id: t.id,
      class_grade: 9,
      subject_code: 'BAN',
      sequence: 1,
      name: 'Attendance',
      kind: ExamComponentKind.ATTENDANCE,
      full_marks: '5.00',
      pass_marks: '0.00',
    } as any);
    const res = await service.create(dto({ template_id: t.id }), SEED_TENANT_ID);
    const c = await ds.getRepository(ExamComponent).findOneByOrFail({ exam_id: res.id });
    expect(c.source).toBe(ExamComponentSource.DERIVED);
  });

  it('two ATTENDANCE rows for one subject -> 400, nothing written', async () => {
    const t = await ds
      .getRepository(ExamTemplate)
      .save({ tenant_id: SEED_TENANT_ID, name: 'DoubleAtt', kind: ExamKind.TERM } as any);
    for (const [i, name] of ['Att1', 'Att2'].entries()) {
      await ds.getRepository(ExamTemplateComponent).save({
        tenant_id: SEED_TENANT_ID,
        template_id: t.id,
        class_grade: 9,
        subject_code: 'BAN',
        sequence: i + 1,
        name,
        kind: ExamComponentKind.ATTENDANCE,
        full_marks: '5.00',
        pass_marks: '0.00',
      } as any);
    }
    await expect(
      service.create(dto({ template_id: t.id }), SEED_TENANT_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await examCount()).toBe(0);
    expect(await compCount()).toBe(0);
  });

  it('later template edit/delete leaves the exam unchanged', async () => {
    const t = await makeTemplate();
    const res = await service.create(dto({ template_id: t.id }), SEED_TENANT_ID);
    await templates.remove(t.id, SEED_TENANT_ID);
    expect(await compCount()).toBe(4);
    expect(
      (
        await ds
          .getRepository(ExamComponent)
          .findOneByOrFail({ exam_id: res.id, name: 'MCQ', subject_id: ban.id })
      ).full_marks,
    ).toBe('25.00');
  });

  it('duplicate exam name is 409 and adds no components', async () => {
    const t = await makeTemplate();
    await service.create(dto({ template_id: t.id }), SEED_TENANT_ID);
    await expect(service.create(dto({ template_id: t.id }), SEED_TENANT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await examCount()).toBe(1);
    expect(await compCount()).toBe(4);
  });

  it('without template_id: no components, audit has no template fields', async () => {
    const res = await service.create(dto(), SEED_TENANT_ID);
    expect(res.components_created).toBe(0);
    expect(await compCount()).toBe(0);
    expect(audit.record.mock.calls[0][0].new_values).not.toHaveProperty('template_id');
  });

  it('DTO rejects a non-uuid template_id', async () => {
    const errs = await validate(plainToInstance(CreateExamDto, { ...dto(), template_id: 'nope' }));
    expect(errs.map((e) => e.property)).toContain('template_id');
  });
});
