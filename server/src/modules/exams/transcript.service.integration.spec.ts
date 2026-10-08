import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { TranscriptService } from './transcript.service';
import { ResultsService } from './results.service';
import { ExamStatus } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [48.2.10] TranscriptService against the real database: ordering, the
 * published/processed gate, a student who left, class scoping, tenant
 * isolation and the audit row written for a print.
 */
const TENANT_ID = SEED_TENANT_ID;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c0199';

describe('[48.2.10] TranscriptService (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: TranscriptService;
  let results: ResultsService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
    service = app.get(TranscriptService);
    results = app.get(ResultsService);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Transcript Other School', 'transcript-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /** Student enrolled in class 1 / the seed year, plus a grading scale and subject. */
  async function seedStudent(enrollmentStatus = 'ACTIVE') {
    const rand = Math.random().toString(36).slice(2, 10);
    const [student] = await ds.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ('Transcript Student', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
      [`TR-${rand}`, Math.floor(Math.random() * 1000000), SEED_SECTION_1_ID, TENANT_ID],
    );
    await ds.query(
      `INSERT INTO enrollments
         (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        student.id,
        SEED_CLASS_1_ID,
        SEED_SECTION_1_ID,
        SEED_ACADEMIC_YEAR_ID,
        enrollmentStatus,
        TENANT_ID,
      ],
    );
    const [scale] = await ds.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, TENANT_ID],
    );
    await ds.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 80, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scale.id, TENANT_ID],
    );
    const [subject] = await ds.query(
      `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
       VALUES ('Mathematics', $1, $2, NOW(), NOW()) RETURNING id`,
      [`TR-M-${rand}`, TENANT_ID],
    );
    return {
      studentId: student.id as string,
      scaleId: scale.id as string,
      subjectId: subject.id as string,
    };
  }

  /** An exam with a result for the student and (optionally) one sitting date. */
  async function seedExam(
    f: { studentId: string; scaleId: string; subjectId: string },
    name: string,
    status: ExamStatus,
    sitting: string | null,
    classId = SEED_CLASS_1_ID,
    withResult = true,
  ): Promise<string> {
    const [exam] = await ds.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'TERM', $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, classId, name, status, TENANT_ID],
    );
    if (sitting) {
      await ds.query(
        `INSERT INTO exam_schedules (exam_id, subject_id, date, starts_at, ends_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, '10:00', '12:00', $4, NOW(), NOW())`,
        [exam.id, f.subjectId, sitting, TENANT_ID],
      );
    }
    if (withResult) {
      const [result] = await ds.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, is_fail,
            grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 5.00, 'A+', 1, false, $3, 1, 'nctb-v1', NOW(), $4, NOW(), NOW()) RETURNING id`,
        [exam.id, f.studentId, f.scaleId, TENANT_ID],
      );
      await ds.query(
        `INSERT INTO result_subjects
           (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 'A+', 5.00, false, false, $3, NOW(), NOW())`,
        [result.id, f.subjectId, TENANT_ID],
      );
    }
    return exam.id;
  }

  const noClock = (c: unknown) =>
    JSON.parse(JSON.stringify(c, (k, v) => (k === 'captured_at' ? undefined : v)));
  const names = (t: { exams: Array<{ exam_name: string }> }) => t.exams.map((e) => e.exam_name);

  it('lists published exams in first-sitting order, each equal to its report card', async () => {
    const f = await seedStudent();
    // Created in the "wrong" order: the later sitting is created first.
    const late = await seedExam(f, 'Final', ExamStatus.PUBLISHED, '2026-11-20');
    const early = await seedExam(f, 'Midterm', ExamStatus.PUBLISHED, '2026-06-10');

    const t = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, true);

    expect(names(t)).toEqual(['Midterm', 'Final']);
    // `issuer.captured_at` is "now" on every call, so compare without it.
    const card = async (id: string) =>
      noClock(await results.getStudentResultCard(id, f.studentId, TENANT_ID, true));
    expect(noClock(t.exams[0])).toEqual(await card(early));
    expect(noClock(t.exams[1])).toEqual(await card(late));
    expect(t.student).toMatchObject({ id: f.studentId, full_name: 'Transcript Student' });
    expect(t.academic_year.id).toBe(SEED_ACADEMIC_YEAR_ID);
  });

  it('staff also get a PROCESSED exam; the family view does not', async () => {
    const f = await seedStudent();
    await seedExam(f, 'Published', ExamStatus.PUBLISHED, '2026-06-10');
    await seedExam(f, 'Processed', ExamStatus.PROCESSED, '2026-07-10');

    const staff = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, false);
    const family = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, true);

    expect(names(staff)).toEqual(['Published', 'Processed']);
    expect(names(family)).toEqual(['Published']);
  });

  it('a student who has since TRANSFERRED still gets that year’s transcript', async () => {
    const f = await seedStudent('TRANSFERRED');
    await seedExam(f, 'Published', ExamStatus.PUBLISHED, '2026-06-10');

    const t = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, true);

    expect(names(t)).toEqual(['Published']);
  });

  it('leaves out an exam of another class in the same year', async () => {
    const f = await seedStudent();
    await seedExam(f, 'Mine', ExamStatus.PUBLISHED, '2026-06-10');
    await seedExam(f, 'Other class', ExamStatus.PUBLISHED, '2026-06-11', SEED_CLASS_2_ID);

    const t = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, true);

    expect(names(t)).toEqual(['Mine']);
  });

  it('skips a published exam in which the student has no result', async () => {
    const f = await seedStudent();
    await seedExam(f, 'No result', ExamStatus.PUBLISHED, '2026-06-10', SEED_CLASS_1_ID, false);

    const t = await service.getTranscript(TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, true);

    expect(t.exams).toEqual([]);
  });

  it('404s for a student of another tenant (cross-tenant)', async () => {
    const f = await seedStudent();

    await expect(
      service.getTranscript(OTHER_TENANT_ID, f.studentId, SEED_ACADEMIC_YEAR_ID, false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('logDocumentPrint', () => {
    const rows = (studentId: string) =>
      ds.query(
        `SELECT * FROM audit_logs WHERE entity_type = 'StudentDocumentPrint' AND entity_id = $1`,
        [studentId],
      );

    it('writes exactly one CREATE audit row for a report card', async () => {
      const f = await seedStudent();
      const examId = await seedExam(f, 'Published', ExamStatus.PUBLISHED, '2026-06-10');

      await service.logDocumentPrint(
        TENANT_ID,
        SEED_ADMIN_USER_ID,
        f.studentId,
        { document: 'REPORT_CARD', exam_id: examId },
        false,
      );

      const found = await rows(f.studentId);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        action: 'CREATE',
        tenant_id: TENANT_ID,
        performed_by_user_id: SEED_ADMIN_USER_ID,
        new_values: { document: 'REPORT_CARD', exam_id: examId },
      });
    });

    it('writes one row for a transcript', async () => {
      const f = await seedStudent();

      await service.logDocumentPrint(
        TENANT_ID,
        SEED_ADMIN_USER_ID,
        f.studentId,
        { document: 'TRANSCRIPT', academic_year_id: SEED_ACADEMIC_YEAR_ID },
        false,
      );

      const found = await rows(f.studentId);
      expect(found).toHaveLength(1);
      expect(found[0].new_values).toEqual({
        document: 'TRANSCRIPT',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
      });
    });

    it('404s and writes nothing when the student has no result in that exam', async () => {
      const f = await seedStudent();
      const examId = await seedExam(
        f,
        'No result',
        ExamStatus.PUBLISHED,
        null,
        SEED_CLASS_1_ID,
        false,
      );

      await expect(
        service.logDocumentPrint(
          TENANT_ID,
          SEED_ADMIN_USER_ID,
          f.studentId,
          { document: 'REPORT_CARD', exam_id: examId },
          false,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await rows(f.studentId)).toHaveLength(0);
    });

    it('404s and writes nothing for a family caller printing an unpublished exam', async () => {
      const f = await seedStudent();
      const examId = await seedExam(f, 'Processed', ExamStatus.PROCESSED, null);

      await expect(
        service.logDocumentPrint(
          TENANT_ID,
          SEED_ADMIN_USER_ID,
          f.studentId,
          { document: 'REPORT_CARD', exam_id: examId },
          true,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await rows(f.studentId)).toHaveLength(0);
    });
  });
});
