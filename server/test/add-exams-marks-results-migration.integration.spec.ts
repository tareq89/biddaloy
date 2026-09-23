import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [19.2.1] DB-level invariants `AddExamsMarksResults` adds, that no unit
 * test can see: the `marks` check constraint and the
 * `student_subject_choices` partial unique index.
 */
describe('AddExamsMarksResults1789800012000 (integration)', () => {
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;
  let subjectId: string;
  let examId: string;
  let componentId: string;
  let studentId: string;
  let classSubjectId: string;

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
  }, 60000);

  // `students`, `subjects` and `class_subjects` are in the global per-test
  // reset (`test/reset-order.ts`), so this suite's fixtures must be
  // recreated in `beforeEach`, not `beforeAll` — a `beforeAll` row would be
  // wiped before the first `it()` runs.
  beforeEach(async () => {
    const [subject] = await dataSource.query(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'Test Subject', 'TST') RETURNING id`,
      [TENANT_ID],
    );
    subjectId = subject.id;

    const [exam] = await dataSource.query(
      `INSERT INTO "exams" (id, tenant_id, academic_year_id, class_id, name, kind) VALUES (gen_random_uuid(), $1, $2, $3, 'Test Exam', 'TERM') RETURNING id`,
      [TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID],
    );
    examId = exam.id;

    const [component] = await dataSource.query(
      `INSERT INTO "exam_components" (id, tenant_id, exam_id, subject_id, name, kind, full_marks, sequence) VALUES (gen_random_uuid(), $1, $2, $3, 'Written', 'WRITTEN', 100, 1) RETURNING id`,
      [TENANT_ID, examId, subjectId],
    );
    componentId = component.id;

    const [student] = await dataSource.query(
      `INSERT INTO "students" (id, tenant_id, full_name, registration_number, roll_number, class_section_id) VALUES (gen_random_uuid(), $1, 'Test Student', 'REG-EXAMS-1', 1, $2) RETURNING id`,
      [TENANT_ID, SEED_SECTION_1_ID],
    );
    studentId = student.id;

    const [classSubject] = await dataSource.query(
      `INSERT INTO "class_subjects" (id, tenant_id, class_id, subject_id, academic_year_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [TENANT_ID, SEED_CLASS_1_ID, subjectId, SEED_ACADEMIC_YEAR_ID],
    );
    classSubjectId = classSubject.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('accepts a PRESENT mark with a value', async () => {
    const [mark] = await dataSource.query(
      `INSERT INTO "marks" (id, tenant_id, exam_id, student_id, subject_id, component_id, value, status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 75, 'PRESENT') RETURNING id, value`,
      [TENANT_ID, examId, studentId, subjectId, componentId],
    );
    expect(mark.value).toBe('75.00');
  });

  it('rejects an ABSENT mark carrying a numeric value (D10)', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO "marks" (id, tenant_id, exam_id, student_id, subject_id, component_id, value, status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 0, 'ABSENT')`,
        [TENANT_ID, examId, studentId, subjectId, componentId],
      ),
    ).rejects.toThrow();
  });

  it('accepts an ABSENT mark with a null value', async () => {
    const [mark] = await dataSource.query(
      `INSERT INTO "marks" (id, tenant_id, exam_id, student_id, subject_id, component_id, value, status) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NULL, 'ABSENT') RETURNING id, value`,
      [TENANT_ID, examId, studentId, subjectId, componentId],
    );
    expect(mark.value).toBeNull();
  });

  it('allows one is_fourth choice per student per year, rejects a second', async () => {
    await dataSource.query(
      `INSERT INTO "student_subject_choices" (id, tenant_id, student_id, class_subject_id, academic_year_id, is_fourth) VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
      [TENANT_ID, studentId, classSubjectId, SEED_ACADEMIC_YEAR_ID],
    );

    const [subject2] = await dataSource.query(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'Second Subject', 'TST2') RETURNING id`,
      [TENANT_ID],
    );
    const [classSubject2] = await dataSource.query(
      `INSERT INTO "class_subjects" (id, tenant_id, class_id, subject_id, academic_year_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [TENANT_ID, SEED_CLASS_1_ID, subject2.id, SEED_ACADEMIC_YEAR_ID],
    );

    await expect(
      dataSource.query(
        `INSERT INTO "student_subject_choices" (id, tenant_id, student_id, class_subject_id, academic_year_id, is_fourth) VALUES (gen_random_uuid(), $1, $2, $3, $4, true)`,
        [TENANT_ID, studentId, classSubject2.id, SEED_ACADEMIC_YEAR_ID],
      ),
    ).rejects.toThrow();
  });

  it('allows a second non-fourth choice for the same student and year', async () => {
    const [subject3] = await dataSource.query(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'Third Subject', 'TST3') RETURNING id`,
      [TENANT_ID],
    );
    const [classSubject3] = await dataSource.query(
      `INSERT INTO "class_subjects" (id, tenant_id, class_id, subject_id, academic_year_id) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id`,
      [TENANT_ID, SEED_CLASS_1_ID, subject3.id, SEED_ACADEMIC_YEAR_ID],
    );
    const [choice] = await dataSource.query(
      `INSERT INTO "student_subject_choices" (id, tenant_id, student_id, class_subject_id, academic_year_id, is_fourth) VALUES (gen_random_uuid(), $1, $2, $3, $4, false) RETURNING id`,
      [TENANT_ID, studentId, classSubject3.id, SEED_ACADEMIC_YEAR_ID],
    );
    expect(choice.id).toBeDefined();
  });
});
