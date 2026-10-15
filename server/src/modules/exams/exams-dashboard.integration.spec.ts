import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ExamComponentKind, ExamKind, ExamStatus, MarkGridState } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { ExamsDashboardService } from './exams-dashboard.service';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';

/**
 * [#1850] Mark-entry progress widget: which exam is "current", and that each
 * class's figures equal `MarkGridService.progress` for that class's exam.
 * Exams, components, grids and classes are wiped between tests, so every test
 * seeds its own.
 */
describe('ExamsDashboardService.getMarkEntryProgress (integration)', () => {
  let app: TestingModule;
  let ds: DataSource;
  let service: ExamsDashboardService;
  let grids: MarkGridService;
  let seq = 0;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000185000';
  const TODAY = '2026-10-07';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ds = app.get(DataSource);
    service = app.get(ExamsDashboardService, { strict: false });
    grids = app.get(MarkGridService, { strict: false });
    await ds
      .getRepository(School)
      .save({ id: OTHER_TENANT_ID, name: 'Mark Entry Other', slug: 'mark-entry-other' });
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => vi.useRealTimers());

  async function makeClass(name: string, sections: number, tenantId = SEED_TENANT_ID) {
    const cls = await ds.getRepository(Class).save({
      name: `${name} ${++seq}`,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: tenantId,
    });
    const sectionIds: string[] = [];
    for (let i = 0; i < sections; i++) {
      const s = await ds.getRepository(ClassSection).save({
        section_name: `S${i}`,
        class_id: cls.id,
        tenant_id: tenantId,
      });
      sectionIds.push(s.id);
    }
    return { classId: cls.id, sectionIds };
  }

  async function makeSubjects(n: number, tenantId = SEED_TENANT_ID) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        (
          await ds.getRepository(Subject).save({
            tenant_id: tenantId,
            name_en: `Subj ${++seq}`,
            name_bn: `বিষয় ${seq}`,
            code: `MEP-${seq}`,
          })
        ).id,
      );
    }
    return ids;
  }

  async function makeExam(opts: {
    classId: string;
    subjectIds: string[];
    name?: string;
    status?: ExamStatus;
    firstSitting?: string;
    lastSitting?: string;
    deadline?: string | null;
    academicYearId?: string;
    tenantId?: string;
  }) {
    const tenantId = opts.tenantId ?? SEED_TENANT_ID;
    const exam = await ds.getRepository(Exam).save({
      academic_year_id: opts.academicYearId ?? SEED_ACADEMIC_YEAR_ID,
      class_id: opts.classId,
      name: opts.name ?? 'Half-yearly',
      kind: ExamKind.TERM,
      status: opts.status ?? ExamStatus.DRAFT,
      mark_entry_deadline: opts.deadline ?? null,
      tenant_id: tenantId,
    });
    for (const subjectId of opts.subjectIds) {
      await ds.getRepository(ExamComponent).save({
        exam_id: exam.id,
        subject_id: subjectId,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
        tenant_id: tenantId,
      });
    }
    const dates = [opts.firstSitting ?? '2026-10-01'];
    if (opts.lastSitting) dates.push(opts.lastSitting);
    for (let i = 0; i < dates.length; i++) {
      // one schedule row per (exam, subject), so a second date needs a second subject
      await ds.getRepository(ExamSchedule).save({
        exam_id: exam.id,
        subject_id: opts.subjectIds[i] ?? opts.subjectIds[0],
        date: dates[i],
        starts_at: '10:00',
        ends_at: '12:00',
        tenant_id: tenantId,
      } as Partial<ExamSchedule>);
    }
    return exam.id;
  }

  const submitGrid = (examId: string, sectionId: string, subjectId: string) =>
    ds.getRepository(MarkGrid).save({
      exam_id: examId,
      section_id: sectionId,
      subject_id: subjectId,
      state: MarkGridState.SUBMITTED,
      tenant_id: SEED_TENANT_ID,
    });

  /** Two classes (2 sections x 3 subjects = 6 grids each); A 3/6, B 6/6. */
  async function twoClassFixture() {
    const subjects = await makeSubjects(3);
    const a = await makeClass('Class A', 2);
    const b = await makeClass('Class B', 2);
    const examA = await makeExam({ classId: a.classId, subjectIds: subjects });
    const examB = await makeExam({ classId: b.classId, subjectIds: subjects });
    await submitGrid(examA, a.sectionIds[0], subjects[0]);
    await submitGrid(examA, a.sectionIds[0], subjects[1]);
    await submitGrid(examA, a.sectionIds[1], subjects[0]);
    for (const sec of b.sectionIds) for (const s of subjects) await submitGrid(examB, sec, s);
    return { subjects, a, b, examA, examB };
  }

  it('reports per-class and overall figures and the lowest class', async () => {
    const { a, b, examA, examB } = await twoClassFixture();

    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

    expect(res.exam_name).toBe('Half-yearly');
    expect(res.overall).toEqual({ submitted: 9, total: 12, percentage: 75 });
    expect(res.lowest_class_id).toBe(a.classId);
    const byClass = Object.fromEntries(res.classes.map((c) => [c.class_id, c]));
    expect(byClass[a.classId]).toMatchObject({
      exam_id: examA,
      class_name: expect.stringContaining('Class A'),
      submitted: 3,
      total: 6,
      percentage: 50,
    });
    expect(byClass[b.classId]).toMatchObject({
      exam_id: examB,
      submitted: 6,
      total: 6,
      percentage: 100,
    });
  });

  it('matches MarkGridService.progress for every class', async () => {
    await twoClassFixture();
    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

    for (const c of res.classes) {
      const { counts } = await grids.progress(c.exam_id, SEED_TENANT_ID, undefined, null);
      expect(c.submitted).toBe(counts[MarkGridState.SUBMITTED]);
      expect(c.total).toBe(counts[MarkGridState.SUBMITTED] + counts[MarkGridState.DRAFT]);
    }
  });

  it('excludes a soft-deleted section and a soft-deleted component from total', async () => {
    const { a, examA } = await twoClassFixture();
    await ds.getRepository(ClassSection).softDelete({ id: a.sectionIds[1] });
    await ds
      .getRepository(ExamComponent)
      .softDelete({
        exam_id: examA,
        subject_id: (await ds.getRepository(ExamComponent).findOneByOrFail({ exam_id: examA }))
          .subject_id,
      });

    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);
    const row = res.classes.find((c) => c.class_id === a.classId)!;
    const { counts } = await grids.progress(examA, SEED_TENANT_ID, undefined, null);

    expect(row.total).toBe(2); // 1 live section x 2 live subjects
    expect(row.submitted).toBe(counts[MarkGridState.SUBMITTED]);
    expect(row.total).toBe(counts[MarkGridState.SUBMITTED] + counts[MarkGridState.DRAFT]);
  });

  it('ignores a not-yet-started exam, a published exam and last year', async () => {
    const subjects = await makeSubjects(1);
    const c = await makeClass('Ignored', 1);
    await makeExam({
      classId: c.classId,
      subjectIds: subjects,
      name: 'Final',
      firstSitting: '2026-11-05',
    });
    await makeExam({
      classId: c.classId,
      subjectIds: subjects,
      name: 'Published one',
      status: ExamStatus.PUBLISHED,
    });
    const lastYear = await ds.getRepository(AcademicYear).save({
      name: 'Last year',
      start_date: new Date('2025-01-01'),
      end_date: new Date('2025-12-31'),
      is_current: false,
      tenant_id: SEED_TENANT_ID,
    });
    await makeExam({
      classId: c.classId,
      subjectIds: subjects,
      name: 'Old',
      academicYearId: lastYear.id,
    });

    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

    expect(res).toMatchObject({ exam_name: null, classes: [], lowest_class_id: null });
  });

  it('picks the started group whose first sitting is later', async () => {
    const subjects = await makeSubjects(1);
    const c = await makeClass('Two groups', 1);
    await makeExam({
      classId: c.classId,
      subjectIds: subjects,
      name: 'Class test',
      firstSitting: '2026-09-01',
    });
    await makeExam({
      classId: c.classId,
      subjectIds: subjects,
      name: 'Half-yearly',
      firstSitting: '2026-10-02',
    });

    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

    expect(res.exam_name).toBe('Half-yearly');
  });

  describe('deadline and ended-days-ago', () => {
    it('returns the latest set deadline of the group', async () => {
      const subjects = await makeSubjects(1);
      const a = await makeClass('DL A', 1);
      const b = await makeClass('DL B', 1);
      await makeExam({ classId: a.classId, subjectIds: subjects });
      await makeExam({ classId: b.classId, subjectIds: subjects, deadline: '2026-10-11' });

      const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

      expect(res.mark_entry_deadline).toBe('2026-10-11');
    });

    it('is null with no deadline; counts days since the last sitting', async () => {
      const subjects = await makeSubjects(2);
      const c = await makeClass('DL C', 1);
      await makeExam({
        classId: c.classId,
        subjectIds: subjects,
        firstSitting: '2026-10-01',
        lastSitting: '2026-10-04',
      });

      const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

      expect(res.mark_entry_deadline).toBeNull();
      expect(res.exam_ended_days_ago).toBe(3);
    });

    it('exam_ended_days_ago is null while sittings remain', async () => {
      const subjects = await makeSubjects(2);
      const c = await makeClass('DL D', 1);
      await makeExam({
        classId: c.classId,
        subjectIds: subjects,
        firstSitting: '2026-10-01',
        lastSitting: '2026-10-09',
      });

      const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

      expect(res.exam_ended_days_ago).toBeNull();
    });
  });

  it('Dhaka midnight: appears at 18:00Z the evening before the first sitting', async () => {
    const subjects = await makeSubjects(1);
    const c = await makeClass('Midnight', 1);
    await makeExam({ classId: c.classId, subjectIds: subjects, firstSitting: '2026-10-08' });
    const { localToday } = await import('../../common/time');
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date('2026-10-07T17:59:00Z'));
    expect((await service.getMarkEntryProgress(SEED_TENANT_ID, localToday())).exam_name).toBeNull();

    vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
    expect((await service.getMarkEntryProgress(SEED_TENANT_ID, localToday())).exam_name).toBe(
      'Half-yearly',
    );
  });

  it("never shows another tenant's exams or grids", async () => {
    const subjects = await makeSubjects(1, OTHER_TENANT_ID);
    const c = await makeClass('Other class', 1, OTHER_TENANT_ID);
    await makeExam({ classId: c.classId, subjectIds: subjects, tenantId: OTHER_TENANT_ID });

    const res = await service.getMarkEntryProgress(SEED_TENANT_ID, TODAY);

    expect(res.exam_name).toBeNull();
  });
});
