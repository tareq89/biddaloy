import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { TeacherAssignmentType1791300000000 } from '../src/migrations/1791300000000-TeacherAssignmentType';

/**
 * [47.1.1] Real-DB checks for `teacher_class_sections.assignment_type`:
 * the DB constraints (D2/D9/D30), the insert-time inference trigger
 * (D20/D28), the backfill, and the `down()` guard.
 *
 * `teachers`/`teacher_class_sections` are truncated before every test
 * (`test/setup.ts`), so teachers and rows are created per test; the
 * section fixture is created once; subjects, like teachers, per test.
 */
describe('TeacherAssignmentType1791300000000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new TeacherAssignmentType1791300000000();

  let sectionId: string;
  let subjectId: string;
  let teacher1: string;
  let teacher2: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    queryRunner = dataSource.createQueryRunner();

    if (!(await dataSource.getRepository(School).findOne({ where: { id: SEED_TENANT_ID } }))) {
      await dataSource.getRepository(School).save({
        id: SEED_TENANT_ID,
        name: 'Seed',
        slug: 'seed-tcs-type',
      });
    }
    const year = await dataSource.getRepository(AcademicYear).save({
      name: 'TCS Type Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: SEED_TENANT_ID,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Class 7', academic_year_id: year.id, tenant_id: SEED_TENANT_ID });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: klass.id, tenant_id: SEED_TENANT_ID });
    sectionId = section.id;
  }, 60000);

  afterAll(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function makeTeacher(): Promise<string> {
    const user = await dataSource.getRepository(User).save({
      email: `tcs-type-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'TCS Type Teacher',
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-TT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    return teacher.id;
  }

  beforeEach(async () => {
    // Subjects are reset between tests, so create one each time.
    const subject = await dataSource.getRepository(Subject).save({
      name_en: 'Maths',
      code: `M${Math.floor(Math.random() * 1e6)}`,
      tenant_id: SEED_TENANT_ID,
    });
    subjectId = subject.id;
    teacher1 = await makeTeacher();
    teacher2 = await makeTeacher();
  });

  function insert(teacherId: string, type: string | null, subject: string | null = null) {
    return dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [teacherId, sectionId, SEED_TENANT_ID, subject, type],
    );
  }

  it('rejects a second CLASS_TEACHER on one section', async () => {
    await insert(teacher1, 'CLASS_TEACHER');
    await expect(insert(teacher2, 'CLASS_TEACHER')).rejects.toThrow(/UQ_tcs_section_class_teacher/);
  });

  it('accepts two ASSISTANT_CLASS_TEACHERs on one section', async () => {
    await insert(teacher1, 'ASSISTANT_CLASS_TEACHER');
    await insert(teacher2, 'ASSISTANT_CLASS_TEACHER');
    const rows = await dataSource.query(`SELECT 1 FROM teacher_class_sections`);
    expect(rows).toHaveLength(2);
  });

  it('rejects the same teacher as CLASS_TEACHER and ASSISTANT on one section', async () => {
    await insert(teacher1, 'CLASS_TEACHER');
    await expect(insert(teacher1, 'ASSISTANT_CLASS_TEACHER')).rejects.toThrow(
      /UQ_tcs_teacher_section_homeroom/,
    );
  });

  it('accepts the same teacher as CLASS_TEACHER and SUBJECT_TEACHER on one section', async () => {
    await insert(teacher1, 'CLASS_TEACHER');
    await insert(teacher1, 'SUBJECT_TEACHER', subjectId);
    const rows = await dataSource.query(`SELECT 1 FROM teacher_class_sections`);
    expect(rows).toHaveLength(2);
  });

  it('rejects SUBJECT_TEACHER without a subject, and a subject on a non-subject type', async () => {
    await expect(insert(teacher1, 'SUBJECT_TEACHER')).rejects.toThrow(
      /CK_tcs_subject_matches_type/,
    );
    await expect(insert(teacher1, 'CLASS_TEACHER', subjectId)).rejects.toThrow(
      /CK_tcs_subject_matches_type/,
    );
  });

  it('infers the type when an insert omits it (trigger)', async () => {
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id) VALUES ($1, $2, $3)`,
      [teacher1, sectionId, SEED_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id) VALUES ($1, $2, $3, $4)`,
      [teacher2, sectionId, SEED_TENANT_ID, subjectId],
    );
    const rows: Array<{ teacher_id: string; assignment_type: string }> = await dataSource.query(
      `SELECT teacher_id, assignment_type FROM teacher_class_sections`,
    );
    const byTeacher = Object.fromEntries(rows.map((r) => [r.teacher_id, r.assignment_type]));
    expect(byTeacher[teacher1]).toBe('CLASS_TEACHER');
    expect(byTeacher[teacher2]).toBe('SUBJECT_TEACHER');
  });

  // All of this runs on `queryRunner` inside one transaction that is rolled
  // back: down()/up() are DDL on the shared worker DB, and a half-finished
  // round trip would poison every later spec on it (Epic 35 lesson).
  it('down() aborts while an ASSISTANT row exists; down()+up() backfills legacy rows', async () => {
    const q = (sql: string, params?: unknown[]) => queryRunner.query(sql, params);
    await queryRunner.startTransaction();
    try {
      await q(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
         VALUES ($1, $2, $3, 'ASSISTANT_CLASS_TEACHER')`,
        [teacher1, sectionId, SEED_TENANT_ID],
      );
      await expect(migration.down(queryRunner)).rejects.toThrow(/ASSISTANT_CLASS_TEACHER/);
      // Aborted before touching anything: the column is still there.
      expect(
        await q(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'teacher_class_sections' AND column_name = 'assignment_type'`,
        ),
      ).toHaveLength(1);
      await q(`DELETE FROM teacher_class_sections`);

      await migration.down(queryRunner);
      // Legacy shape: no assignment_type; NULL subject = class teacher.
      await q(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id) VALUES ($1, $2, $3)`,
        [teacher1, sectionId, SEED_TENANT_ID],
      );
      await q(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id) VALUES ($1, $2, $3, $4)`,
        [teacher2, sectionId, SEED_TENANT_ID, subjectId],
      );
      await migration.up(queryRunner);

      const rows: Array<{ teacher_id: string; assignment_type: string }> = await q(
        `SELECT teacher_id, assignment_type FROM teacher_class_sections`,
      );
      const byTeacher = Object.fromEntries(rows.map((r) => [r.teacher_id, r.assignment_type]));
      expect(byTeacher[teacher1]).toBe('CLASS_TEACHER');
      expect(byTeacher[teacher2]).toBe('SUBJECT_TEACHER');
    } finally {
      await queryRunner.rollbackTransaction();
    }
  });
});
