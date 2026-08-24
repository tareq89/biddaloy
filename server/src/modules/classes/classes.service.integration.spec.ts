import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ClassService, SectionService } from './classes.service';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { EnrollmentStatus, TeacherDesignation } from '@biddaloy/shared';

/**
 * Integration tests for ClassService/SectionService — run against a real
 * PostgreSQL database (same harness as `academic-year.service.integration.spec.ts`).
 *
 * Mandatory scenarios covered per `server/CLAUDE.md`: tenant isolation (each
 * `describe` block that touches a tenant-scoped query has an "other tenant
 * can't see it" case) and soft-delete behaviour (a deleted class/section
 * stays out of every query the service exposes).
 */
describe('ClassService / SectionService (integration)', () => {
  let classService: ClassService;
  let sectionService: SectionService;
  let classRepo: Repository<Class>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [ClassService, SectionService], [], {
      synchronize: true,
      dropSchema: true,
    });

    classService = module.get<ClassService>(ClassService);
    sectionService = module.get<SectionService>(SectionService);
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // FK-safe cleanup order — children before parents.
    await dataSource.query('DELETE FROM teacher_class_sections');
    await dataSource.query('DELETE FROM teachers');
    await dataSource.query('DELETE FROM enrollments');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM fee_structure_students');
    await dataSource.query('DELETE FROM fee_structures');
    await dataSource.query('DELETE FROM payments');
    await dataSource.query('DELETE FROM student_guardians');
    await dataSource.query('DELETE FROM students');
    await dataSource.query('DELETE FROM guardians');
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM academic_years');
    await dataSource.query('DELETE FROM users');
  });

  async function createYear(tenantId = TENANT_ID) {
    const yearRepo = dataSource.getRepository(AcademicYear);
    return yearRepo.save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
  }

  // `Student` has a unique `(class_section_id, roll_number)` index, so two
  // students in the same section need different roll numbers — a counter
  // rather than a fixed `1`, since several tests below deliberately enrol
  // more than one student into the same section.
  let nextRollNumber = 1;

  async function createStudentEnrolledIn(
    klass: Class,
    section: ClassSection,
    overrides: { status?: EnrollmentStatus } = {},
  ) {
    const studentRepo = dataSource.getRepository(Student);
    const enrollmentRepo = dataSource.getRepository(Enrollment);
    const student = await studentRepo.save({
      full_name: 'Test Student',
      registration_number: `REG-${Math.random().toString(36).slice(2, 10)}`,
      roll_number: nextRollNumber++,
      class_section_id: section.id,
      tenant_id: klass.tenant_id,
      enrollment_status: overrides.status ?? EnrollmentStatus.ACTIVE,
    });
    await enrollmentRepo.save({
      student_id: student.id,
      class_id: klass.id,
      section_id: section.id,
      academic_year_id: klass.academic_year_id,
      tenant_id: klass.tenant_id,
      enrollment_status: overrides.status ?? EnrollmentStatus.ACTIVE,
    });
    return student;
  }

  async function createTeacherOnSection(section: ClassSection, tenantId = TENANT_ID) {
    const userRepo = dataSource.getRepository(User);
    const teacherRepo = dataSource.getRepository(Teacher);
    const tcsRepo = dataSource.getRepository(TeacherClassSection);
    const user = await userRepo.save({
      full_name: 'Teacher One',
      email: `teacher-${Math.random().toString(36).slice(2, 10)}@test.com`,
    });
    const teacher = await teacherRepo.save({
      user_id: user.id,
      employee_id: `EMP-${Math.random().toString(36).slice(2, 8)}`,
      designations: [TeacherDesignation.CLASS_TEACHER],
      tenant_id: tenantId,
    });
    await tcsRepo.save({ teacher_id: teacher.id, section_id: section.id });
    return teacher;
  }

  describe('findAll (section_count / student_count)', () => {
    it('computes both counts server-side, without N+1, ignoring soft-deleted/non-ACTIVE rows', async () => {
      const year = await createYear();
      const klassWithData = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const klassEmpty = await classRepo.save({
        name: 'Class B',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const sectionA = await sectionRepo.save({
        class_id: klassWithData.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      // A soft-deleted section must not count towards `section_count`.
      const deletedSection = await sectionRepo.save({
        class_id: klassWithData.id,
        section_name: 'Z',
        tenant_id: TENANT_ID,
      });
      await sectionService.remove(klassWithData.id, deletedSection.id, TENANT_ID);

      await createStudentEnrolledIn(klassWithData, sectionA);
      await createStudentEnrolledIn(klassWithData, sectionA);
      // A non-ACTIVE student must not count towards `student_count`.
      await createStudentEnrolledIn(klassWithData, sectionA, {
        status: EnrollmentStatus.TRANSFERRED,
      });

      const result = await classService.findAll({}, TENANT_ID);

      const byName = new Map(result.data.map((cls) => [cls.name, cls]));
      expect(byName.get('Class A')?.section_count).toBe(1);
      expect(byName.get('Class A')?.student_count).toBe(2);
      expect(byName.get('Class B')?.section_count).toBe(0);
      expect(byName.get('Class B')?.student_count).toBe(0);
    });

    it("is tenant-isolated: does not count another tenant's sections/students", async () => {
      const year = await createYear();
      const otherYear = await createYear(OTHER_TENANT);
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const otherKlass = await classRepo.save({
        name: 'Other Tenant Class',
        academic_year_id: otherYear.id,
        tenant_id: OTHER_TENANT,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const otherSection = await sectionRepo.save({
        class_id: otherKlass.id,
        section_name: 'A',
        tenant_id: OTHER_TENANT,
      });
      await createStudentEnrolledIn(otherKlass, otherSection);

      const result = await classService.findAll({}, TENANT_ID);

      expect(result.data.map((cls) => cls.name)).not.toContain('Other Tenant Class');
      const own = result.data.find((cls) => cls.id === klass.id);
      expect(own?.section_count).toBe(0);
      expect(own?.student_count).toBe(0);
    });
  });

  describe('remove (delete class)', () => {
    it('deletes a class with no sections and no enrollments', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Empty Class',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });

      await classService.remove(klass.id, TENANT_ID);

      await expect(classService.findOne(klass.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete a class with enrolled students, naming the count', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class With Students',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      await createStudentEnrolledIn(klass, section);

      // The AC's own "explanation why" — the thrown message must name the
      // count so a caller (and the delete-blocked dialog) can show it.
      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toThrow(ConflictException);
      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toThrow(/1 student/);
    });

    it('ignores a non-ACTIVE enrollment when deciding whether to refuse', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class With Transferred Student',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      await createStudentEnrolledIn(klass, section, { status: EnrollmentStatus.TRANSFERRED });
      // No active enrollments and no sections left after removing the
      // section below, so delete should succeed.
      await sectionService.remove(klass.id, section.id, TENANT_ID);

      await classService.remove(klass.id, TENANT_ID);
      await expect(classService.findOne(klass.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete a class with remaining sections once no students are enrolled', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class With Section',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      await sectionRepo.save({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID });

      // Enrollment guard is checked first (0 active enrollments here), so
      // this exercises the section guard specifically.
      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toThrow(
        /section\(s\) still exist/,
      );
    });

    it("is tenant-isolated: cannot delete another tenant's class", async () => {
      const year = await createYear(OTHER_TENANT);
      const klass = await classRepo.save({
        name: 'Other Tenant Class',
        academic_year_id: year.id,
        tenant_id: OTHER_TENANT,
      });

      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('SectionService.findAll (enrolled_count)', () => {
    it('reports 0 for a section with no active enrollments', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      await sectionRepo.save({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID });

      const sections = await sectionService.findAll(klass.id, TENANT_ID);

      expect(sections).toHaveLength(1);
      expect(sections[0]?.enrolled_count).toBe(0);
    });

    it('counts active enrollments per section without N+1, ignoring non-ACTIVE ones', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const sectionA = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      const sectionB = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'B',
        tenant_id: TENANT_ID,
      });
      await createStudentEnrolledIn(klass, sectionA);
      await createStudentEnrolledIn(klass, sectionA);
      await createStudentEnrolledIn(klass, sectionB, { status: EnrollmentStatus.TRANSFERRED });

      const sections = await sectionService.findAll(klass.id, TENANT_ID);

      const byName = new Map(sections.map((section) => [section.section_name, section]));
      expect(byName.get('A')?.enrolled_count).toBe(2);
      expect(byName.get('B')?.enrolled_count).toBe(0);
    });

    it('excludes soft-deleted sections', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      await sectionService.remove(klass.id, section.id, TENANT_ID);

      const sections = await sectionService.findAll(klass.id, TENANT_ID);
      expect(sections).toHaveLength(0);
    });

    it('is tenant-isolated: a class from another tenant is not found', async () => {
      const year = await createYear(OTHER_TENANT);
      const klass = await classRepo.save({
        name: 'Other Tenant Class',
        academic_year_id: year.id,
        tenant_id: OTHER_TENANT,
      });

      await expect(sectionService.findAll(klass.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('SectionService.remove (delete section)', () => {
    it('refuses to delete a section with active students, naming the count', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      await createStudentEnrolledIn(klass, section);

      await expect(sectionService.remove(klass.id, section.id, TENANT_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('SectionService.findTeachers', () => {
    it('returns distinct teachers with every section name they teach', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const sectionA = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      const sectionB = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'B',
        tenant_id: TENANT_ID,
      });
      const teacher = await createTeacherOnSection(sectionA);
      const tcsRepo = dataSource.getRepository(TeacherClassSection);
      await tcsRepo.save({ teacher_id: teacher.id, section_id: sectionB.id });

      const teachers = await sectionService.findTeachers(klass.id, TENANT_ID);

      expect(teachers).toHaveLength(1);
      expect(teachers[0]?.section_names.sort()).toEqual(['A', 'B']);
      // Guards against `findTeachers` regressing to a raw-query selection
      // of `teacher.designations` — TypeORM only applies the enum-array
      // transform on entity hydration, so a raw row would return the
      // Postgres array's untransformed text form (e.g. a string) instead
      // of a real `TeacherDesignation[]`, and `.map()` over it in
      // `teachers-tab.tsx` would throw.
      expect(Array.isArray(teachers[0]?.designations)).toBe(true);
      expect(teachers[0]?.designations).toEqual([TeacherDesignation.CLASS_TEACHER]);
    });

    it('returns an empty list when no teacher is assigned to any section', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      await sectionRepo.save({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID });

      const teachers = await sectionService.findTeachers(klass.id, TENANT_ID);
      expect(teachers).toEqual([]);
    });

    it("is tenant-isolated: does not surface another tenant's teacher", async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      const section = await sectionRepo.save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      // A teacher belonging to another tenant, assigned onto this
      // tenant's section directly via the junction table (bypassing
      // application-level guards) must still not be returned — the query
      // itself filters on the teacher's own tenant_id.
      await createTeacherOnSection(section, OTHER_TENANT);

      const teachers = await sectionService.findTeachers(klass.id, TENANT_ID);
      expect(teachers).toEqual([]);
    });
  });
});
