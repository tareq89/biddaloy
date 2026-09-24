import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { Student } from '../../students/entities/student.entity';
import { Homework } from './homework.entity';
import { HomeworkAssignment } from './homework-assignment.entity';
import { HomeworkSubmission } from './homework-submission.entity';
import { SyllabusTopic } from './syllabus-topic.entity';
import {
  HomeworkGradingMode,
  HomeworkAssignmentStatus,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
  EnrollmentStatus,
} from '@biddaloy/shared';

/**
 * Integration tests for the [22.2.1] homework/syllabus entities — run
 * against the real, migrated test database (not `{ synchronize: true,
 * dropSchema: true }` — see `server/CLAUDE.md`) so the `homework_assignments`
 * CHECK constraint and `homework_submissions` unique index, both migration-only
 * raw-SQL objects, are actually exercised.
 */
describe('homework entities (integration)', () => {
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  let classId: string;
  let sectionId: string;
  let subjectId: string;
  let studentId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // FK-safe cleanup order — children before parents.
    await dataSource.query('DELETE FROM homework_submissions');
    await dataSource.query('DELETE FROM homework_assignments');
    await dataSource.query('DELETE FROM homework');
    await dataSource.query('DELETE FROM syllabus_topics');
    await dataSource.query('DELETE FROM students');
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');
    await dataSource.query('DELETE FROM subjects');

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);
    const subjectRepo = dataSource.getRepository(Subject);
    const studentRepo = dataSource.getRepository(Student);

    const year = await yearRepo.save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Class 6',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'A',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    const subject = await subjectRepo.save({
      name_en: 'Mathematics',
      code: 'MATH',
      tenant_id: TENANT_ID,
    });
    const student = await studentRepo.save({
      full_name: 'Test Student',
      registration_number: 'REG-0001',
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: TENANT_ID,
      enrollment_status: EnrollmentStatus.ACTIVE,
    });

    classId = klass.id;
    sectionId = section.id;
    subjectId = subject.id;
    studentId = student.id;
  });

  describe('Homework', () => {
    let repo: Repository<Homework>;
    beforeEach(() => {
      repo = dataSource.getRepository(Homework);
    });

    it('inserts and reads a homework', async () => {
      const homework = await repo.save({
        tenant_id: TENANT_ID,
        subject_id: subjectId,
        class_id: classId,
        title: 'Algebra worksheet',
        grading_mode: HomeworkGradingMode.MARKS,
      });

      const found = await repo.findOne({ where: { id: homework.id } });
      expect(found?.title).toBe('Algebra worksheet');
      expect(found?.attachments).toEqual([]);
    });
  });

  describe('HomeworkAssignment', () => {
    let repo: Repository<HomeworkAssignment>;
    let homeworkId: string;

    beforeEach(async () => {
      repo = dataSource.getRepository(HomeworkAssignment);
      const homework = await dataSource.getRepository(Homework).save({
        tenant_id: TENANT_ID,
        subject_id: subjectId,
        class_id: classId,
        title: 'Algebra worksheet',
        grading_mode: HomeworkGradingMode.MARKS,
      });
      homeworkId = homework.id;
    });

    it('inserts and reads a section assignment', async () => {
      const assignment = await repo.save({
        tenant_id: TENANT_ID,
        homework_id: homeworkId,
        section_id: sectionId,
        student_id: null,
        assigned_date: '2026-09-24',
        due_date: '2026-09-30',
        status: HomeworkAssignmentStatus.ACTIVE,
      });

      const found = await repo.findOne({ where: { id: assignment.id } });
      expect(found?.section_id).toBe(sectionId);
      expect(found?.student_id).toBeNull();
    });

    it('inserts and reads a student assignment', async () => {
      const assignment = await repo.save({
        tenant_id: TENANT_ID,
        homework_id: homeworkId,
        section_id: null,
        student_id: studentId,
        assigned_date: '2026-09-24',
        due_date: '2026-09-30',
        status: HomeworkAssignmentStatus.ACTIVE,
      });

      const found = await repo.findOne({ where: { id: assignment.id } });
      expect(found?.student_id).toBe(studentId);
      expect(found?.section_id).toBeNull();
    });

    it('rejects both section_id and student_id null', async () => {
      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          homework_id: homeworkId,
          section_id: null,
          student_id: null,
          assigned_date: '2026-09-24',
          due_date: '2026-09-30',
          status: HomeworkAssignmentStatus.ACTIVE,
        }),
      ).rejects.toThrow(QueryFailedError);
    });

    it('rejects both section_id and student_id non-null', async () => {
      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          homework_id: homeworkId,
          section_id: sectionId,
          student_id: studentId,
          assigned_date: '2026-09-24',
          due_date: '2026-09-30',
          status: HomeworkAssignmentStatus.ACTIVE,
        }),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  describe('HomeworkSubmission', () => {
    let repo: Repository<HomeworkSubmission>;
    let assignmentId: string;

    beforeEach(async () => {
      repo = dataSource.getRepository(HomeworkSubmission);
      const homework = await dataSource.getRepository(Homework).save({
        tenant_id: TENANT_ID,
        subject_id: subjectId,
        class_id: classId,
        title: 'Algebra worksheet',
        grading_mode: HomeworkGradingMode.MARKS,
      });
      const assignment = await dataSource.getRepository(HomeworkAssignment).save({
        tenant_id: TENANT_ID,
        homework_id: homework.id,
        section_id: null,
        student_id: studentId,
        assigned_date: '2026-09-24',
        due_date: '2026-09-30',
        status: HomeworkAssignmentStatus.ACTIVE,
      });
      assignmentId = assignment.id;
    });

    it('inserts and reads a submission, defaulting to NOT_SUBMITTED', async () => {
      const submission = await repo.save({
        tenant_id: TENANT_ID,
        assignment_id: assignmentId,
        student_id: studentId,
      });

      const found = await repo.findOne({ where: { id: submission.id } });
      expect(found?.status).toBe(HomeworkSubmissionStatus.NOT_SUBMITTED);
      expect(found?.attachments).toEqual([]);
      expect(found?.marks).toBeNull();
    });

    it('rejects a second submission for the same assignment and student', async () => {
      await repo.save({
        tenant_id: TENANT_ID,
        assignment_id: assignmentId,
        student_id: studentId,
        status: HomeworkSubmissionStatus.SUBMITTED,
      });

      await expect(
        repo.save({
          tenant_id: TENANT_ID,
          assignment_id: assignmentId,
          student_id: studentId,
          status: HomeworkSubmissionStatus.DONE,
        }),
      ).rejects.toThrow(QueryFailedError);
    });
  });

  describe('SyllabusTopic', () => {
    let repo: Repository<SyllabusTopic>;
    beforeEach(() => {
      repo = dataSource.getRepository(SyllabusTopic);
    });

    it('inserts and reads a topic', async () => {
      const topic = await repo.save({
        tenant_id: TENANT_ID,
        class_id: classId,
        subject_id: subjectId,
        name: 'Fractions',
        sequence: 1,
        status: SyllabusTopicStatus.PLANNED,
      });

      const found = await repo.findOne({ where: { id: topic.id } });
      expect(found?.name).toBe('Fractions');
      expect(found?.status).toBe(SyllabusTopicStatus.PLANNED);
    });
  });
});
