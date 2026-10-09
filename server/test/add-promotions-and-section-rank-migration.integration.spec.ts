import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [788] DB-level invariants `AddPromotionsAndSectionRank` adds, that no
 * unit test can see: the `results.section_id`/`section_position` backfill
 * logic (D23), the `promotion_entries` override-note CHECK (D6/D11), and
 * the `promotion_runs` partial-unique committed index (D15).
 */
describe('AddPromotionsAndSectionRank1789800014000 (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('results.section_id / section_position backfill', () => {
    let examId: string;
    let scaleId: string;
    const studentIds: Record<string, string> = {};

    beforeEach(async () => {
      const [scale] = await dataSource.query(
        `INSERT INTO "grading_scales" (id, tenant_id, academic_year_id, name) VALUES (gen_random_uuid(), $1, $2, 'Test Scale') RETURNING id`,
        [TENANT_ID, SEED_ACADEMIC_YEAR_ID],
      );
      scaleId = scale.id;

      const [exam] = await dataSource.query(
        `INSERT INTO "exams" (id, tenant_id, academic_year_id, class_id, name, kind) VALUES (gen_random_uuid(), $1, $2, $3, 'Backfill Exam', 'TERM') RETURNING id`,
        [TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID],
      );
      examId = exam.id;

      // Two students actively enrolled in section 1, one in section 2, one
      // with no ACTIVE enrollment at all (backfill must leave it NULL).
      const keys = ['secA1', 'secA2', 'secB1', 'noEnrollment'];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const [student] = await dataSource.query(
          `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
          [TENANT_ID, `Student ${key}`, `REG-PROMO-${key}`, i + 1, SEED_SECTION_1_ID],
        );
        studentIds[key] = student.id;
      }

      await dataSource.query(
        `INSERT INTO "enrollments" (id, tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE')`,
        [TENANT_ID, studentIds.secA1, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID],
      );
      await dataSource.query(
        `INSERT INTO "enrollments" (id, tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE')`,
        [TENANT_ID, studentIds.secA2, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID],
      );
      await dataSource.query(
        `INSERT INTO "enrollments" (id, tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE')`,
        [TENANT_ID, studentIds.secB1, SEED_CLASS_1_ID, SEED_SECTION_2_ID, SEED_ACADEMIC_YEAR_ID],
      );
      // noEnrollment stays without any enrollments row.

      const insertResult = async (
        studentKey: string,
        gpa: string,
        totalMarks: string,
        isFail = false,
      ) =>
        dataSource.query(
          `INSERT INTO "results" (id, tenant_id, exam_id, student_id, total_marks, gpa, grade, is_fail, grading_scale_id, grading_scale_revision, rule_version, computed_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'A', $6, $7, 1, 'v1', now())`,
          [TENANT_ID, examId, studentIds[studentKey], totalMarks, gpa, isFail, scaleId],
        );

      await insertResult('secA1', '5.00', '900');
      await insertResult('secA2', '5.00', '900'); // tie with secA1 within section 1
      await insertResult('secB1', '4.00', '850');
      await insertResult('noEnrollment', '3.00', '700', true); // fails, no enrollment either

      // Apply the migration's own backfill SQL directly, since this spec
      // runs against schema already at HEAD (backfill only matters once,
      // at migration time, but this proves the SQL is correct).
      await dataSource.query(
        `
        UPDATE "results" r
        SET "section_id" = e."section_id"
        FROM "exams" x, "enrollments" e
        WHERE r."exam_id" = x."id"
          AND e."student_id" = r."student_id"
          AND e."academic_year_id" = x."academic_year_id"
          AND e."class_id" = x."class_id"
          AND e."enrollment_status" = 'ACTIVE'
          AND r."deleted_at" IS NULL
          AND r."exam_id" = $1
      `,
        [examId],
      );
      await dataSource.query(
        `
        UPDATE "results" r
        SET "section_position" = ranked."rank"
        FROM (
          SELECT "id", RANK() OVER (
            PARTITION BY "exam_id", "section_id"
            ORDER BY "gpa" DESC, "total_marks" DESC
          ) AS "rank"
          FROM "results"
          WHERE "deleted_at" IS NULL AND "is_fail" = false AND "section_id" IS NOT NULL AND "exam_id" = $1
        ) ranked
        WHERE r."id" = ranked."id"
      `,
        [examId],
      );
    });

    it('resolves section_id from the ACTIVE enrollment and leaves it null with none', async () => {
      const rows = await dataSource.query(
        `SELECT student_id, section_id FROM "results" WHERE exam_id = $1`,
        [examId],
      );
      const byStudent = Object.fromEntries(
        rows.map((r: { student_id: string; section_id: string | null }) => [
          r.student_id,
          r.section_id,
        ]),
      );
      expect(byStudent[studentIds.secA1]).toBe(SEED_SECTION_1_ID);
      expect(byStudent[studentIds.secA2]).toBe(SEED_SECTION_1_ID);
      expect(byStudent[studentIds.secB1]).toBe(SEED_SECTION_2_ID);
      expect(byStudent[studentIds.noEnrollment]).toBeNull();
    });

    it('ranks section_position per section, restarting at 1, ties sharing a rank, fails staying null', async () => {
      const rows = await dataSource.query(
        `SELECT student_id, section_position FROM "results" WHERE exam_id = $1`,
        [examId],
      );
      const byStudent = Object.fromEntries(
        rows.map((r: { student_id: string; section_position: number | null }) => [
          r.student_id,
          r.section_position,
        ]),
      );
      expect(byStudent[studentIds.secA1]).toBe(1); // tied with secA2
      expect(byStudent[studentIds.secA2]).toBe(1);
      expect(byStudent[studentIds.secB1]).toBe(1); // rank restarts in section 2
      expect(byStudent[studentIds.noEnrollment]).toBeNull(); // is_fail = true
    });

    it('leaves position untouched by the backfill', async () => {
      const rows = await dataSource.query(`SELECT position FROM "results" WHERE exam_id = $1`, [
        examId,
      ]);
      expect(rows.every((r: { position: number | null }) => r.position === null)).toBe(true);
    });
  });

  describe('promotion_entries override-note CHECK (D6/D11)', () => {
    let runId: string;

    beforeEach(async () => {
      const [run] = await dataSource.query(
        `INSERT INTO "promotion_runs" (id, tenant_id, source_class_id, source_academic_year_id, target_academic_year_id, exam_ids, algorithm, created_by_user_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $3, ARRAY[]::uuid[], 'MERIT', gen_random_uuid()) RETURNING id`,
        [TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID],
      );
      runId = run.id;
    });

    const insertEntry = async (isOverride: boolean, overrideNote: string | null) =>
      dataSource.query(
        `INSERT INTO "promotion_entries" (id, tenant_id, run_id, student_id, source_enrollment_id, passed_all, suggested_outcome, final_outcome, is_override, override_note)
         VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), gen_random_uuid(), true, 'PROMOTE', 'PROMOTE', $3, $4) RETURNING id`,
        [TENANT_ID, runId, isOverride, overrideNote],
      );

    it('rejects is_override = true with a null override_note', async () => {
      await expect(insertEntry(true, null)).rejects.toThrow();
    });

    it('rejects is_override = true with a blank/whitespace-only override_note', async () => {
      await expect(insertEntry(true, '   \t\n')).rejects.toThrow();
    });

    it('accepts is_override = true with a real override_note', async () => {
      const [entry] = await insertEntry(true, 'Manual override: exceptional circumstances');
      expect(entry.id).toBeDefined();
    });

    it('accepts is_override = false with a null override_note', async () => {
      const [entry] = await insertEntry(false, null);
      expect(entry.id).toBeDefined();
    });
  });

  describe('promotion_runs committed-unique partial index (D15)', () => {
    const insertRun = async (status: 'DRAFT' | 'COMMITTED', targetYearId: string) =>
      dataSource.query(
        `INSERT INTO "promotion_runs" (id, tenant_id, source_class_id, source_academic_year_id, target_academic_year_id, exam_ids, algorithm, status, created_by_user_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, ARRAY[]::uuid[], 'MERIT', $5, gen_random_uuid()) RETURNING id`,
        [TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID, targetYearId, status],
      );

    it('allows two DRAFT runs for the same source class and target year', async () => {
      await insertRun('DRAFT', SEED_ACADEMIC_YEAR_ID);
      const [second] = await insertRun('DRAFT', SEED_ACADEMIC_YEAR_ID);
      expect(second.id).toBeDefined();
    });

    it('rejects a second COMMITTED run for the same source class and target year', async () => {
      await insertRun('COMMITTED', SEED_ACADEMIC_YEAR_ID);
      await expect(insertRun('COMMITTED', SEED_ACADEMIC_YEAR_ID)).rejects.toThrow();
    });
  });
});
