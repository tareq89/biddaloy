import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExamKind } from '@biddaloy/shared';
import { ExamsService } from './exams.service';
import { ExamSchedulesService } from './exam-schedules.service';
import { ExamTemplatesService } from './exam-templates.service';
import { ResultsService } from './results.service';
import { Exam } from './entities/exam.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { School } from '../schools/entities/school.entity';
import { AuditService } from '../audit/audit.service';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';

/**
 * [69.3.02] ExamsService and ExamSchedulesService write paths against a closed year, on a real
 * database (the unit specs mock the guard). Each refusal must leave no row change and no audit.
 */
const TENANT = SEED_TENANT_ID;
const OPEN_YEAR = '00000000-0000-4000-8000-0000000e1001';
const SHUT_YEAR = '00000000-0000-4000-8000-0000000e1002';
const OPEN_CLASS = '00000000-0000-4000-8000-0000000e1011';
const SHUT_CLASS = '00000000-0000-4000-8000-0000000e1012';
const closed = { response: { details: { code: 'ACADEMIC_YEAR_CLOSED' } } };

describe('exam writes in a closed year (integration)', () => {
  let exams: ExamsService;
  let schedules: ExamSchedulesService;
  let ds: DataSource;
  let audit: { record: ReturnType<typeof vi.fn> };
  let subject: Subject;

  beforeAll(async () => {
    audit = { record: vi.fn(async () => undefined) };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ExamsService,
        ExamSchedulesService,
        ExamTemplatesService,
        { provide: ResultsService, useValue: {} },
        { provide: AuditService, useValue: audit },
        ...[
          Exam,
          Mark,
          Class,
          AcademicYear,
          AcademicTerm,
          ExamSchedule,
          ExamComponent,
          Subject,
        ].map((e) => ({
          provide: getRepositoryToken(e),
          useFactory: (d: DataSource) => d.getRepository(e),
          inject: [DataSource],
        })),
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    exams = module.get(ExamsService);
    schedules = module.get(ExamSchedulesService);
    ds = module.get(DataSource);
    await ds
      .getRepository(School)
      .save({ id: TENANT, name: 'T', slug: 't', tenant_id: TENANT } as never);
    await ds.getRepository(AcademicYear).save([
      {
        id: OPEN_YEAR,
        name: '2026',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: TENANT,
      },
      {
        id: SHUT_YEAR,
        name: '2025',
        start_date: new Date('2025-01-01'),
        end_date: new Date('2025-12-31'),
        is_current: false,
        tenant_id: TENANT,
      },
    ] as never);
    await ds.getRepository(Class).save([
      { id: OPEN_CLASS, name: 'Six', academic_year_id: OPEN_YEAR, tenant_id: TENANT },
      { id: SHUT_CLASS, name: 'Five', academic_year_id: SHUT_YEAR, tenant_id: TENANT },
    ] as never);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    audit.record.mockClear();
    subject = await ds
      .getRepository(Subject)
      .save({ tenant_id: TENANT, code: 'MAT', name_en: 'Maths' } as never);
  });

  const shut = () =>
    ds.query(`UPDATE academic_years SET closed_at = now(), is_current = false WHERE id = $1`, [
      SHUT_YEAR,
    ]);
  afterEach(() =>
    ds.query(`UPDATE academic_years SET closed_at = NULL WHERE id = $1`, [SHUT_YEAR]),
  );

  const mkExam = (year: string, cls: string, name = 'Mid') =>
    ds.getRepository(Exam).save({
      tenant_id: TENANT,
      academic_year_id: year,
      class_id: cls,
      name,
      kind: ExamKind.TERM,
    } as never);
  const examRows = () => ds.getRepository(Exam).find({ withDeleted: true, order: { id: 'ASC' } });

  it('create is refused and inserts nothing', async () => {
    await shut();
    await expect(
      exams.create(
        { name: 'Mid', kind: ExamKind.TERM, academic_year_id: SHUT_YEAR, class_id: SHUT_CLASS },
        TENANT,
      ),
    ).rejects.toMatchObject(closed);
    expect(await examRows()).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('update is refused and leaves the row as it was', async () => {
    const exam = await mkExam(SHUT_YEAR, SHUT_CLASS);
    await shut();
    await expect(exams.update(exam.id, { name: 'Renamed' }, TENANT)).rejects.toMatchObject(closed);
    expect((await examRows())[0].name).toBe('Mid');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('update moving an exam INTO a closed year is refused; an open-year update still works', async () => {
    const exam = await mkExam(OPEN_YEAR, OPEN_CLASS);
    await shut();
    await expect(
      exams.update(exam.id, { academic_year_id: SHUT_YEAR, class_id: SHUT_CLASS }, TENANT),
    ).rejects.toMatchObject(closed);
    expect((await examRows())[0]).toMatchObject({ academic_year_id: OPEN_YEAR, name: 'Mid' });

    const done = await exams.update(exam.id, { name: 'Renamed' }, TENANT);
    expect(done.name).toBe('Renamed');
  });

  it('remove is refused and the exam stays live', async () => {
    const exam = await mkExam(SHUT_YEAR, SHUT_CLASS);
    await shut();
    await expect(exams.remove(exam.id, TENANT)).rejects.toMatchObject(closed);
    expect((await examRows())[0].deleted_at).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  describe('exam schedules', () => {
    const body = (over: Record<string, unknown> = {}) =>
      ({
        subject_id: subject.id,
        date: '2025-03-10',
        starts_at: '10:00:00',
        ends_at: '12:00:00',
        ...over,
      }) as never;
    const scheduleRows = () =>
      ds.getRepository(ExamSchedule).find({ withDeleted: true, order: { id: 'ASC' } });

    it('create is refused and inserts nothing', async () => {
      const exam = await mkExam(SHUT_YEAR, SHUT_CLASS);
      await shut();
      await expect(schedules.create(exam.id, body(), TENANT)).rejects.toMatchObject(closed);
      expect(await scheduleRows()).toHaveLength(0);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('update and remove are refused and change nothing', async () => {
      const exam = await mkExam(SHUT_YEAR, SHUT_CLASS);
      const row = await ds.getRepository(ExamSchedule).save({
        tenant_id: TENANT,
        exam_id: exam.id,
        subject_id: subject.id,
        date: '2025-03-10',
        starts_at: '10:00:00',
        ends_at: '12:00:00',
      } as never);
      await shut();
      await expect(
        schedules.update(exam.id, row.id, { venue: 'Hall B' } as never, TENANT),
      ).rejects.toMatchObject(closed);
      await expect(schedules.remove(exam.id, row.id, TENANT)).rejects.toMatchObject(closed);
      const [after] = await scheduleRows();
      expect(after.deleted_at).toBeNull();
      expect(after.venue ?? null).toBeNull();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
