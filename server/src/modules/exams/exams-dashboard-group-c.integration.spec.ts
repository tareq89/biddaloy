import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { EnrollmentStatus, ExamKind, ExamStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { ExamsDashboardService } from './exams-dashboard.service';
import { AnalysisService } from './analysis.service';
import { ExamsService } from './exams.service';
import { Exam } from './entities/exam.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';

/**
 * [#1891] Committee pass rate + results state. Only PUBLISHED exams count for
 * the committee; every figure must agree with the analysis page / exam list.
 */
describe('ExamsDashboardService group C (integration)', () => {
  let app: TestingModule;
  let ds: DataSource;
  let service: ExamsDashboardService;
  let analysis: AnalysisService;
  let exams: ExamsService;
  let seq = 0;

  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000001891001';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ds = app.get(DataSource);
    service = app.get(ExamsDashboardService, { strict: false });
    analysis = app.get(AnalysisService, { strict: false });
    exams = app.get(ExamsService, { strict: false });
    await ds
      .getRepository(School)
      .save({ id: OTHER_TENANT_ID, name: 'Group C Other', slug: 'group-c-other' });
  }, 60000);

  beforeEach(async () => {
    // exams cascade to results; classes are re-created per test
    await ds.query(`DELETE FROM exams WHERE tenant_id = ANY($1)`, [
      [SEED_TENANT_ID, OTHER_TENANT_ID],
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function makeClass(name: string, grade: number, tenantId = SEED_TENANT_ID) {
    const cls = await ds.getRepository(Class).save({
      name: `${name} ${++seq}`,
      numeric_grade: grade,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: tenantId,
    } as Partial<Class>);
    const section = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: cls.id, tenant_id: tenantId });
    return { classId: cls.id, sectionId: section.id };
  }

  async function makeExam(opts: {
    classId: string;
    name: string;
    status: ExamStatus;
    publishedAt?: string | null;
    academicYearId?: string;
    tenantId?: string;
  }) {
    const exam = await ds.getRepository(Exam).save({
      academic_year_id: opts.academicYearId ?? SEED_ACADEMIC_YEAR_ID,
      class_id: opts.classId,
      name: opts.name,
      kind: ExamKind.TERM,
      status: opts.status,
      published_at: opts.publishedAt ? new Date(opts.publishedAt) : null,
      tenant_id: opts.tenantId ?? SEED_TENANT_ID,
    });
    return exam.id;
  }

  /** `passed` passing results and `failed` failing ones for one exam. */
  async function addResults(
    examId: string,
    sectionId: string,
    passed: number,
    failed: number,
    tenantId = SEED_TENANT_ID,
  ) {
    // one default scale per (tenant, year): reuse the seeded one or make it once
    let [scale] = await ds.query(
      `SELECT id FROM grading_scales WHERE tenant_id = $1 AND academic_year_id = $2 LIMIT 1`,
      [tenantId, SEED_ACADEMIC_YEAR_ID],
    );
    if (!scale) {
      [scale] = await ds.query(
        `INSERT INTO grading_scales (id, tenant_id, academic_year_id, name)
         VALUES (gen_random_uuid(), $1, $2, 'Scale') RETURNING id`,
        [tenantId, SEED_ACADEMIC_YEAR_ID],
      );
    }
    const ids: string[] = [];
    for (let i = 0; i < passed + failed; i++) {
      const n = ++seq;
      const s = await ds.getRepository(Student).save({
        full_name: `GC Student ${n}`,
        registration_number: `GC-REG-${n}`,
        roll_number: n,
        class_section_id: sectionId,
        tenant_id: tenantId,
        date_of_birth: new Date('2012-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
      } as Partial<Student>);
      const fail = i >= passed;
      const [r] = await ds.query(
        `INSERT INTO results (id, tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail,
                              grading_scale_id, grading_scale_revision, rule_version, computed_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 50, $4, $5, $6, $7, 1, 'test', NOW()) RETURNING id`,
        [tenantId, examId, s.id, fail ? 0 : 4, fail ? 'F' : 'A', fail, scale.id],
      );
      ids.push(r.id);
    }
    return ids;
  }

  const lastYear = () =>
    ds.getRepository(AcademicYear).save({
      name: `Last year ${++seq}`,
      start_date: new Date('2025-01-01'),
      end_date: new Date('2025-12-31'),
      is_current: false,
      tenant_id: SEED_TENANT_ID,
    });

  describe('getCommitteePassRate', () => {
    it('returns the empty shape when nothing is published', async () => {
      const c = await makeClass('Nine', 9);
      await makeExam({ classId: c.classId, name: 'Half', status: ExamStatus.DRAFT });
      expect(await service.getCommitteePassRate(SEED_TENANT_ID)).toEqual({
        exam_name: null,
        classes: [],
        overall_pass_percentage: null,
        recent_rounds: [],
        previous_pass_percentage: null,
      });
    });

    it('latest PUBLISHED round: per-class and overall exact; PROCESSED round never appears', async () => {
      const nine = await makeClass('Nine', 9);
      const ten = await makeClass('Ten', 10);
      // older round: 1/2 and 2/2 pass -> 3/4 = 75
      const o9 = await makeExam({
        classId: nine.classId,
        name: 'First',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-03-01T00:00:00Z',
      });
      const o10 = await makeExam({
        classId: ten.classId,
        name: 'First',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-03-02T00:00:00Z',
      });
      await addResults(o9, nine.sectionId, 1, 1);
      await addResults(o10, ten.sectionId, 2, 0);
      // newer round: nine 1/3 pass, ten 3/3 pass -> 4/6 = 66.7
      const n9 = await makeExam({
        classId: nine.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      const n10 = await makeExam({
        classId: ten.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-02T00:00:00Z',
      });
      await addResults(n9, nine.sectionId, 1, 2);
      await addResults(n10, ten.sectionId, 3, 0);
      // newest of all but PROCESSED: must be ignored
      const p9 = await makeExam({
        classId: nine.classId,
        name: 'Final',
        status: ExamStatus.PROCESSED,
        publishedAt: '2026-10-01T00:00:00Z',
      });
      await addResults(p9, nine.sectionId, 5, 0);

      const res = await service.getCommitteePassRate(SEED_TENANT_ID);

      expect(res.exam_name).toBe('Half');
      expect(res.classes.map((c) => [c.numeric_grade, c.appeared, c.pass_percentage])).toEqual([
        [9, 3, 33.3],
        [10, 3, 100],
      ]);
      expect(res.overall_pass_percentage).toBe(66.7);
      expect(res.recent_rounds).toEqual([
        { exam_name: 'First', pass_percentage: 75 },
        { exam_name: 'Half', pass_percentage: 66.7 },
      ]);
      expect(res.previous_pass_percentage).toBe(75);
    });

    it('pass-mark boundary: a class with exactly half passing is 50, all failing is 0', async () => {
      const a = await makeClass('A', 6);
      const b = await makeClass('B', 7);
      const ea = await makeExam({
        classId: a.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      const eb = await makeExam({
        classId: b.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      await addResults(ea, a.sectionId, 1, 1);
      await addResults(eb, b.sectionId, 0, 2);
      const res = await service.getCommitteePassRate(SEED_TENANT_ID);
      expect(res.classes.map((c) => c.pass_percentage)).toEqual([50, 0]);
      expect(res.overall_pass_percentage).toBe(25);
    });

    it("each class's pass_percentage equals AnalysisService.getPassFail overall", async () => {
      const a = await makeClass('A', 6);
      const b = await makeClass('B', 7);
      const ea = await makeExam({
        classId: a.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      const eb = await makeExam({
        classId: b.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      await addResults(ea, a.sectionId, 2, 1);
      await addResults(eb, b.sectionId, 5, 2);
      const res = await service.getCommitteePassRate(SEED_TENANT_ID);
      const pa = (await analysis.getPassFail(ea, SEED_TENANT_ID)).overall.pass_pct;
      const pb = (await analysis.getPassFail(eb, SEED_TENANT_ID)).overall.pass_pct;
      expect(res.classes.map((c) => c.pass_percentage)).toEqual([pa, pb]);
    });

    it('ignores a soft-deleted result and a soft-deleted exam', async () => {
      const a = await makeClass('A', 6);
      const b = await makeClass('B', 7);
      const ea = await makeExam({
        classId: a.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      const eb = await makeExam({
        classId: b.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      const ids = await addResults(ea, a.sectionId, 1, 1);
      await addResults(eb, b.sectionId, 4, 0);
      await ds.query(`UPDATE results SET deleted_at = NOW() WHERE id = $1`, [ids[1]]); // the failure
      await ds.query(`UPDATE exams SET deleted_at = NOW() WHERE id = $1`, [eb]);
      const res = await service.getCommitteePassRate(SEED_TENANT_ID);
      expect(res.classes).toHaveLength(1);
      expect(res.classes[0]).toMatchObject({ appeared: 1, pass_percentage: 100 });
    });

    it('does not leak another tenant', async () => {
      const o = await makeClass('Other', 9, OTHER_TENANT_ID);
      const eo = await makeExam({
        classId: o.classId,
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
        tenantId: OTHER_TENANT_ID,
      });
      await addResults(eo, o.sectionId, 3, 0, OTHER_TENANT_ID);
      expect((await service.getCommitteePassRate(SEED_TENANT_ID)).classes).toEqual([]);
      expect((await service.getCommitteePassRate(OTHER_TENANT_ID)).classes).toHaveLength(1);
    });
  });

  describe('getResultsState', () => {
    it('counts per round and totals; excludes last year; unpublished rounds first', async () => {
      // an exam is unique per (year, class, name): one class per exam of a round
      const mk = async (name: string, status: ExamStatus, publishedAt?: string, y?: string) =>
        makeExam({
          classId: (await makeClass('C', 6)).classId,
          name,
          status,
          publishedAt: publishedAt ?? null,
          academicYearId: y,
        });
      await mk('Half', ExamStatus.PUBLISHED, '2026-09-01T00:00:00Z');
      await mk('Half', ExamStatus.PUBLISHED, '2026-09-20T06:00:00Z');
      await mk('Half', ExamStatus.PUBLISHED, '2026-09-10T00:00:00Z');
      await mk('Half', ExamStatus.PROCESSED);
      await mk('Half', ExamStatus.PROCESSED);
      await mk('Quiz', ExamStatus.DRAFT);
      await mk('Done', ExamStatus.PUBLISHED, '2026-09-25T00:00:00Z');
      await mk('Old', ExamStatus.PUBLISHED, '2025-09-01T00:00:00Z', (await lastYear()).id);

      const res = await service.getResultsState(SEED_TENANT_ID);

      expect(res).toMatchObject({ draft: 1, processed: 2, published: 4 });
      // unpublished rounds first (Half has a newer publish than Quiz's none), then Done
      expect(res.rounds).toEqual([
        {
          exam_name: 'Half',
          class_count: 5,
          draft: 0,
          processed: 2,
          published: 3,
          last_published_at: '2026-09-20T06:00:00.000Z',
        },
        {
          exam_name: 'Quiz',
          class_count: 1,
          draft: 1,
          processed: 0,
          published: 0,
          last_published_at: null,
        },
        {
          exam_name: 'Done',
          class_count: 1,
          draft: 0,
          processed: 0,
          published: 1,
          last_published_at: '2026-09-25T00:00:00.000Z',
        },
      ]);
    });

    it('state counts match ExamsService.findAll rows for the current year', async () => {
      const cls = async () => (await makeClass('C', 6)).classId;
      await makeExam({
        classId: await cls(),
        name: 'Half',
        status: ExamStatus.PUBLISHED,
        publishedAt: '2026-09-01T00:00:00Z',
      });
      await makeExam({ classId: await cls(), name: 'Half', status: ExamStatus.PROCESSED });
      await makeExam({ classId: await cls(), name: 'Half', status: ExamStatus.DRAFT });
      const soft = await makeExam({ classId: await cls(), name: 'Half', status: ExamStatus.DRAFT });
      await ds.query(`UPDATE exams SET deleted_at = NOW() WHERE id = $1`, [soft]);

      const res = await service.getResultsState(SEED_TENANT_ID);
      const { data } = await exams.findAll(
        { academic_year_id: SEED_ACADEMIC_YEAR_ID, limit: 100 } as never,
        SEED_TENANT_ID,
      );
      const rows = data.filter((e) => e.name === 'Half');
      const round = res.rounds[0];
      for (const s of ['DRAFT', 'PROCESSED', 'PUBLISHED'] as const) {
        expect(round[s.toLowerCase() as 'draft' | 'processed' | 'published']).toBe(
          rows.filter((e) => e.status === s).length,
        );
      }
      expect(round.draft + round.processed + round.published).toBe(rows.length);
    });

    it('does not leak another tenant', async () => {
      const o = await makeClass('Other', 9, OTHER_TENANT_ID);
      await makeExam({
        classId: o.classId,
        name: 'Half',
        status: ExamStatus.DRAFT,
        tenantId: OTHER_TENANT_ID,
      });
      expect(await service.getResultsState(SEED_TENANT_ID)).toMatchObject({ draft: 0, rounds: [] });
    });
  });
});
