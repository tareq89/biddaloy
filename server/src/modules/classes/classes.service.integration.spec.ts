import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource, QueryFailedError } from 'typeorm';
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
import {
  EnrollmentStatus,
  TeacherDesignation,
  TeacherAssignmentType,
  AuditAction,
} from '@biddaloy/shared';
import { Subject } from '../academics/entities/subject.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';

/** [33.2.1] A real `SchoolSettingsReader` needs `SchoolsService` and its
 * whole DI graph (encryption, caching, ...) — this test only needs a
 * fixed vocabulary, so a stub provider stands in, same as any other
 * integration spec that fakes a cross-module read dependency rather than
 * wiring the entire owning module in. */
const FAKE_ORGANISATION_VOCABULARY = {
  shifts: ['Morning', 'Day'],
  versions: ['Bangla', 'English'],
  groups: [],
};

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
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ClassService,
        SectionService,
        AuditService,
        {
          provide: SchoolSettingsReader,
          useValue: {
            organisationVocabulary: async () => FAKE_ORGANISATION_VOCABULARY,
          },
        },
      ],
      [],
      {
        synchronize: true,
        dropSchema: true,
      },
    );

    classService = module.get<ClassService>(ClassService);
    sectionService = module.get<SectionService>(SectionService);
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    dataSource = module.get<DataSource>(getDataSourceToken());

    // `class.entity.ts` deliberately does not declare the
    // `NULLS NOT DISTINCT` unique index via `@Index` — TypeORM's decorator
    // can't express it, so `1789800010700-AddOrganisationDimensions.ts`
    // is the source of truth, not `synchronize: true` above. This test
    // module runs no migrations, so the index is created by hand here,
    // matching `1791900000400-CaseInsensitiveAcademicNames.ts` `up()` exactly (it replaced the index from
    // `1789800010700-AddOrganisationDimensions.ts` with a `lower("name")` key).
    await dataSource.query(
      `CREATE UNIQUE INDEX "IDX_cl_name_year_tenant_shift_version" ON "classes" (lower("name"), "academic_year_id", "tenant_id", "shift", "version") NULLS NOT DISTINCT`,
    );

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
    await tcsRepo.save({ teacher_id: teacher.id, section_id: section.id, tenant_id: tenantId });
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

  describe('findAll (shift/version filters) [33.3.1]', () => {
    it('filters to only classes with the given shift', async () => {
      const year = await createYear();
      await classRepo.save({
        name: 'Morning Class',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: 'Morning',
      });
      await classRepo.save({
        name: 'Day Class',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: 'Day',
      });

      const result = await classService.findAll({ shift: 'Morning' } as any, TENANT_ID);

      expect(result.data.map((cls) => cls.name)).toEqual(['Morning Class']);
    });

    it('returns an empty page for a shift value that matches no class, not a 500', async () => {
      const year = await createYear();
      await classRepo.save({
        name: 'Morning Class',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: 'Morning',
      });

      const result = await classService.findAll({ shift: 'Nonexistent Shift' } as any, TENANT_ID);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("create (academic year must be live and this tenant's)", () => {
    it('refuses a soft-deleted academic year', async () => {
      const year = await createYear();
      await dataSource.getRepository(AcademicYear).softDelete(year.id);

      await expect(
        classService.create({ name: 'Ghost', academic_year_id: year.id } as any, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
      expect(await classRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
    });

    it("refuses another school's academic year (the FK alone only checks the id exists)", async () => {
      const otherYear = await createYear(OTHER_TENANT);

      await expect(
        classService.create({ name: 'Cross', academic_year_id: otherYear.id } as any, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
      expect(await classRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(0);
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

    // [2703 M1] An event with no class links is school-wide, so dropping the
    // last link would publish a class-only event to every class.
    it('hides an event scoped only to the deleted class and keeps a shared event for the other class', async () => {
      const year = await createYear();
      const [a, b] = await classRepo.save([
        { name: 'Class A', academic_year_id: year.id, tenant_id: TENANT_ID },
        { name: 'Class B', academic_year_id: year.id, tenant_id: TENANT_ID },
      ]);
      const eventRepo = dataSource.getRepository(CalendarEvent);
      const event = (name: string) =>
        eventRepo.save({
          tenant_id: TENANT_ID,
          academic_year_id: year.id,
          start_date: '2026-03-01',
          end_date: '2026-03-01',
          name,
          published_at: new Date(),
        });
      const onlyA = await event('Class A picnic');
      const shared = await event('A and B trip');
      await dataSource.getRepository(CalendarEventClass).save([
        { event_id: onlyA.id, class_id: a.id, tenant_id: TENANT_ID },
        { event_id: shared.id, class_id: a.id, tenant_id: TENANT_ID },
        { event_id: shared.id, class_id: b.id, tenant_id: TENANT_ID },
      ]);

      await classService.remove(a.id, TENANT_ID);

      // Not school-wide: the class-only event is gone with its class.
      expect(await eventRepo.findOne({ where: { id: onlyA.id } })).toBeNull();
      const links = await dataSource
        .getRepository(CalendarEventClass)
        .find({ where: { event_id: shared.id } });
      expect(links.map((l) => l.class_id)).toEqual([b.id]);
      expect(await eventRepo.findOne({ where: { id: shared.id } })).not.toBeNull();
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
      // [2703 m1] One fixed text (no id echo); the count is in details.
      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toMatchObject({
        response: {
          message: 'This class is still used by other records. Remove or reassign them first.',
          details: { code: 'CLASS_IN_USE', count: 2 },
        },
      });
    });

    it('[68.2.12] cannot delete a class whose only students are GRADUATED', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class With Graduate',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await dataSource.getRepository(ClassSection).save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      await createStudentEnrolledIn(klass, section, { status: EnrollmentStatus.GRADUATED });

      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toMatchObject({
        response: { details: { code: 'CLASS_IN_USE' } },
      });
    });

    // Review r1 #8: a deleted student's kept enrollment row must not block.
    it('a deleted student no longer blocks the class delete with CLASS_IN_USE', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class With Deleted Student',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await dataSource.getRepository(ClassSection).save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      const student = await createStudentEnrolledIn(klass, section);
      await dataSource.query('UPDATE students SET deleted_at = now() WHERE id = $1', [student.id]);
      await dataSource.getRepository(ClassSection).softDelete({ id: section.id });

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
      await expect(classService.remove(klass.id, TENANT_ID)).rejects.toMatchObject({
        response: { details: { code: 'CLASS_IN_USE', sections_count: 1 } },
      });
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

    // Regression: the routine builder grid reads `section.class.shift_id`
    // straight off this response (client-admin's $sectionId.tsx). `find`
    // without `relations` left `class` undefined and crashed that page.
    it('includes the parent class relation on every section', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift_id: null,
      });
      const sectionRepo = dataSource.getRepository(ClassSection);
      await sectionRepo.save({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID });

      const sections = await sectionService.findAll(klass.id, TENANT_ID);

      expect(sections[0]?.class?.id).toBe(klass.id);
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
    async function makeSection(name: string) {
      const year = await createYear();
      const klass = await classRepo.save({
        name,
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await dataSource.getRepository(ClassSection).save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      return { klass, section };
    }

    it('refuses to delete a section with active students, naming the count', async () => {
      const { klass, section } = await makeSection('Class A');
      await createStudentEnrolledIn(klass, section);

      await expect(sectionService.remove(klass.id, section.id, TENANT_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('[68.2.12] cannot delete a section that holds a INACTIVE (left) student', async () => {
      const { klass, section } = await makeSection('Class W');
      await createStudentEnrolledIn(klass, section, { status: EnrollmentStatus.INACTIVE });

      await expect(sectionService.remove(klass.id, section.id, TENANT_ID)).rejects.toMatchObject({
        response: { details: { code: 'SECTION_IN_USE' } },
      });
      expect(
        await dataSource.getRepository(ClassSection).count({ where: { id: section.id } }),
      ).toBe(1);
    });

    it('[68.2.12] cannot delete a section that only an enrollment row points at', async () => {
      const { klass, section } = await makeSection('Class E');
      const student = await createStudentEnrolledIn(klass, section);
      // The student now sits elsewhere; only the history row still names this section.
      const other = await dataSource.getRepository(ClassSection).save({
        class_id: klass.id,
        section_name: 'B',
        tenant_id: TENANT_ID,
      });
      await dataSource.query('UPDATE students SET class_section_id = $1 WHERE id = $2', [
        other.id,
        student.id,
      ]);

      await expect(sectionService.remove(klass.id, section.id, TENANT_ID)).rejects.toMatchObject({
        response: { details: { code: 'SECTION_IN_USE' } },
      });
    });

    // Review r1 #8: StudentService.remove keeps the enrollment rows (INACTIVE),
    // so counting them would block the section forever.
    it('can delete a section whose only student was deleted', async () => {
      const { klass, section } = await makeSection('Class D');
      const student = await createStudentEnrolledIn(klass, section);
      await dataSource.query('UPDATE students SET deleted_at = now() WHERE id = $1', [student.id]);

      await sectionService.remove(klass.id, section.id, TENANT_ID);

      expect(
        await dataSource.getRepository(ClassSection).count({ where: { id: section.id } }),
      ).toBe(0);
    });

    it('[68.2.12] can delete an empty section', async () => {
      const { klass, section } = await makeSection('Class Empty');

      await sectionService.remove(klass.id, section.id, TENANT_ID);

      expect(
        await dataSource.getRepository(ClassSection).count({ where: { id: section.id } }),
      ).toBe(0);
    });
  });

  describe('SectionService.assignTeacher / listSectionTeachers [47.2.1]', () => {
    const T = TeacherAssignmentType;

    async function setup() {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await dataSource
        .getRepository(ClassSection)
        .save({ class_id: klass.id, section_name: 'A', tenant_id: TENANT_ID });
      const subject = await dataSource
        .getRepository(Subject)
        .save({ name_en: 'Math', code: 'MATH', tenant_id: TENANT_ID });
      return { klass, section, subject };
    }

    async function newTeacher(name: string, tenantId = TENANT_ID) {
      const user = await dataSource.getRepository(User).save({
        full_name: name,
        email: `t-${Math.random().toString(36).slice(2, 10)}@test.com`,
      });
      return dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `EMP-${Math.random().toString(36).slice(2, 8)}`,
        designations: [TeacherDesignation.CLASS_TEACHER],
        tenant_id: tenantId,
      });
    }

    const rows = (sectionId: string) =>
      dataSource.getRepository(TeacherClassSection).find({ where: { section_id: sectionId } });

    it('CLASS_TEACHER replaces the previous CLASS_TEACHER but not assistants', async () => {
      const { klass, section } = await setup();
      const [a, b, c] = [await newTeacher('A'), await newTeacher('B'), await newTeacher('C')];
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: c.id, assignment_type: T.ASSISTANT_CLASS_TEACHER },
        TENANT_ID,
      );
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, assignment_type: T.CLASS_TEACHER },
        TENANT_ID,
      );
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: b.id, assignment_type: T.CLASS_TEACHER },
        TENANT_ID,
      );
      const got = await rows(section.id);
      expect(got.map((r) => [r.teacher_id, r.assignment_type]).sort()).toEqual(
        [
          [b.id, T.CLASS_TEACHER],
          [c.id, T.ASSISTANT_CLASS_TEACHER],
        ].sort(),
      );
    });

    it('allows several assistants on one section', async () => {
      const { klass, section } = await setup();
      const [a, b] = [await newTeacher('A'), await newTeacher('B')];
      for (const t of [a, b]) {
        await sectionService.assignTeacher(
          klass.id,
          section.id,
          { teacher_id: t.id, assignment_type: T.ASSISTANT_CLASS_TEACHER },
          TENANT_ID,
        );
      }
      expect(await rows(section.id)).toHaveLength(2);
    });

    it('409 TEACHER_ALREADY_HOMEROOM for CLASS + ASSISTANT of the same teacher', async () => {
      const { klass, section } = await setup();
      const a = await newTeacher('A');
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, assignment_type: T.CLASS_TEACHER },
        TENANT_ID,
      );
      const err = await sectionService
        .assignTeacher(
          klass.id,
          section.id,
          { teacher_id: a.id, assignment_type: T.ASSISTANT_CLASS_TEACHER },
          TENANT_ID,
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('TEACHER_ALREADY_HOMEROOM');
    });

    it('promoting an assistant to CLASS_TEACHER leaves one row', async () => {
      const { klass, section } = await setup();
      const a = await newTeacher('A');
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, assignment_type: T.ASSISTANT_CLASS_TEACHER },
        TENANT_ID,
      );
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, assignment_type: T.CLASS_TEACHER },
        TENANT_ID,
      );
      const got = await rows(section.id);
      expect(got).toHaveLength(1);
      expect(got[0]?.assignment_type).toBe(T.CLASS_TEACHER);
    });

    it('SUBJECT_TEACHER without subject_id -> 400; CLASS_TEACHER with subject_id -> 400', async () => {
      const { klass, section, subject } = await setup();
      const a = await newTeacher('A');
      await expect(
        sectionService.assignTeacher(
          klass.id,
          section.id,
          { teacher_id: a.id, assignment_type: T.SUBJECT_TEACHER },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        sectionService.assignTeacher(
          klass.id,
          section.id,
          { teacher_id: a.id, assignment_type: T.CLASS_TEACHER, subject_id: subject.id },
          TENANT_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('infers the type when omitted (D20)', async () => {
      const { klass, section, subject } = await setup();
      const a = await newTeacher('A');
      const cls = await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id },
        TENANT_ID,
      );
      const sub = await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, subject_id: subject.id },
        TENANT_ID,
      );
      expect(cls.assignment_type).toBe(T.CLASS_TEACHER);
      expect(sub.assignment_type).toBe(T.SUBJECT_TEACHER);
    });

    it('maps a simulated 23505 on save to 409', async () => {
      const { klass, section } = await setup();
      const a = await newTeacher('A');
      const spy = vi.spyOn(Repository.prototype, 'save').mockRejectedValueOnce(
        Object.assign(
          new QueryFailedError('q', [], {
            code: '23505',
            constraint: 'UQ_tcs_section_class_teacher',
          } as never),
          {
            driverError: { code: '23505', constraint: 'UQ_tcs_section_class_teacher' },
          },
        ),
      );
      try {
        await expect(
          sectionService.assignTeacher(klass.id, section.id, { teacher_id: a.id }, TENANT_ID),
        ).rejects.toThrow(ConflictException);
      } finally {
        spy.mockRestore();
      }
    });

    it('404 for a section in another tenant', async () => {
      const { klass, section } = await setup();
      const a = await newTeacher('A');
      await expect(
        sectionService.assignTeacher(klass.id, section.id, { teacher_id: a.id }, OTHER_TENANT),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 for a teacher in another tenant', async () => {
      const { klass, section } = await setup();
      const other = await newTeacher('Other', OTHER_TENANT);
      await expect(
        sectionService.assignTeacher(klass.id, section.id, { teacher_id: other.id }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists assignment_type, ordered CLASS, ASSISTANT, SUBJECT', async () => {
      const { klass, section, subject } = await setup();
      const [a, b, c] = [await newTeacher('A'), await newTeacher('B'), await newTeacher('C')];
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: a.id, subject_id: subject.id },
        TENANT_ID,
      );
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: b.id, assignment_type: T.ASSISTANT_CLASS_TEACHER },
        TENANT_ID,
      );
      await sectionService.assignTeacher(
        klass.id,
        section.id,
        { teacher_id: c.id, assignment_type: T.CLASS_TEACHER },
        TENANT_ID,
      );
      const list = await sectionService.listSectionTeachers(klass.id, section.id, TENANT_ID);
      expect(list.map((r) => r.assignment_type)).toEqual([
        T.CLASS_TEACHER,
        T.ASSISTANT_CLASS_TEACHER,
        T.SUBJECT_TEACHER,
      ]);
    });
  });

  // [15.2.3] every Class/ClassSection mutation writes a tenant-scoped audit
  // row with field-level old/new values, sharing the mutation's transaction.
  describe('audit', () => {
    let auditLogRepo: Repository<AuditLog>;
    let actorUserId: string;

    beforeAll(() => {
      auditLogRepo = dataSource.getRepository(AuditLog);
    });

    // Nested `beforeEach` — runs after the outer describe's own
    // `beforeEach`, which deletes every row in `users` for test isolation.
    // `audit_logs.performed_by_user_id` FKs to `users.id`, so the actor
    // must be re-created for every test in this block, not once in a
    // `beforeAll`.
    beforeEach(async () => {
      const userRepo = dataSource.getRepository(User);
      const actor = await userRepo.save({
        full_name: 'Audit Actor',
        email: `audit-actor-${Math.random().toString(36).slice(2, 8)}@test.com`,
      });
      actorUserId = actor.id;
    });

    it('writes a CREATE audit record for a new class', async () => {
      const year = await createYear();

      const created = await classService.create(
        { name: 'Class A', academic_year_id: year.id } as any,
        TENANT_ID,
        actorUserId,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Class', action: AuditAction.CREATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
      expect(logs[0]?.new_values).toMatchObject({ name: 'Class A' });
    });

    it('writes an UPDATE audit record capturing old and new class values', async () => {
      const year = await createYear();
      const created = await classService.create(
        { name: 'Class A', academic_year_id: year.id } as any,
        TENANT_ID,
      );

      await classService.update(
        created.id,
        { name: 'Class A Renamed' } as any,
        TENANT_ID,
        actorUserId,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Class', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.old_values).toMatchObject({ name: 'Class A' });
      expect(logs[0]?.new_values).toMatchObject({ name: 'Class A Renamed' });
    });

    it('writes a DELETE audit record on class remove', async () => {
      const year = await createYear();
      const created = await classService.create(
        { name: 'Class A', academic_year_id: year.id } as any,
        TENANT_ID,
      );

      await classService.remove(created.id, TENANT_ID, actorUserId);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Class', action: AuditAction.DELETE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
    });

    it('writes a CREATE/UPDATE/DELETE audit record for a class section', async () => {
      const year = await createYear();
      const klass = await classRepo.save({
        name: 'Class A',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });

      const created = await sectionService.create(
        klass.id,
        { section_name: 'A' } as any,
        TENANT_ID,
        actorUserId,
      );
      let logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'ClassSection', action: AuditAction.CREATE },
      });
      expect(logs).toHaveLength(1);

      await sectionService.update(
        klass.id,
        created.id,
        { section_name: 'A Renamed' } as any,
        TENANT_ID,
        actorUserId,
      );
      logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'ClassSection', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.old_values).toMatchObject({ section_name: 'A' });
      expect(logs[0]?.new_values).toMatchObject({ section_name: 'A Renamed' });

      await sectionService.remove(klass.id, created.id, TENANT_ID, actorUserId);
      logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'ClassSection', action: AuditAction.DELETE },
      });
      expect(logs).toHaveLength(1);
    });

    it('rolls back both the class row and the audit entry on a forced failure', async () => {
      const before = await classRepo.count({ where: { tenant_id: TENANT_ID } });

      await expect(
        classService.update(
          '00000000-0000-4000-8000-000000000001',
          { name: 'X' } as any,
          TENANT_ID,
        ),
      ).rejects.toThrow(NotFoundException);

      const after = await classRepo.count({ where: { tenant_id: TENANT_ID } });
      expect(after).toBe(before);

      const logs = await auditLogRepo.find({
        where: { entity_id: '00000000-0000-4000-8000-000000000001', entity_type: 'Class' },
      });
      expect(logs).toHaveLength(0);
    });

    it("never exposes another tenant's class audit rows", async () => {
      const year = await createYear(OTHER_TENANT);
      const created = await classService.create(
        { name: 'Cross Tenant Class', academic_year_id: year.id } as any,
        OTHER_TENANT,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Class', tenant_id: TENANT_ID },
      });
      expect(logs).toHaveLength(0);

      const otherTenantLogs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Class', tenant_id: OTHER_TENANT },
      });
      expect(otherTenantLogs).toHaveLength(1);
    });
  });

  describe('unique index (name, academic_year_id, tenant_id, shift, version) [33.2.1]', () => {
    it('allows two same-name classes in the same year distinguished by shift', async () => {
      const year = await createYear();

      const morning = await classService.create(
        { name: 'Class 6', academic_year_id: year.id, shift: 'Morning' } as any,
        TENANT_ID,
      );
      const day = await classService.create(
        { name: 'Class 6', academic_year_id: year.id, shift: 'Day' } as any,
        TENANT_ID,
      );

      expect(morning.id).not.toBe(day.id);
    });

    it('rejects a second class with the same name/year/shift', async () => {
      const year = await createYear();
      await classService.create(
        { name: 'Class 6', academic_year_id: year.id, shift: 'Morning' } as any,
        TENANT_ID,
      );

      // Asserts the actual unique-violation constraint, not just "some
      // error" — a bare `.rejects.toThrow()` would also pass if the
      // create failed for an unrelated reason (e.g. a bug that rejects
      // every second create), giving false confidence in the index.
      await expect(
        classService.create(
          { name: 'Class 6', academic_year_id: year.id, shift: 'Morning' } as any,
          TENANT_ID,
        ),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'IDX_cl_name_year_tenant_shift_version',
      });
    });

    it(
      'rejects a second class with the same name/year and NULL shift — proves ' +
        'NULLS NOT DISTINCT closes the gap a plain unique index would leave open',
      async () => {
        const year = await createYear();
        await classService.create({ name: 'Class 6', academic_year_id: year.id } as any, TENANT_ID);

        await expect(
          classService.create({ name: 'Class 6', academic_year_id: year.id } as any, TENANT_ID),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'IDX_cl_name_year_tenant_shift_version',
        });
      },
    );

    it('allows two same-name classes in the same year distinguished only by version', async () => {
      const year = await createYear();

      const bangla = await classService.create(
        { name: 'Class 6', academic_year_id: year.id, version: 'Bangla' } as any,
        TENANT_ID,
      );
      const english = await classService.create(
        { name: 'Class 6', academic_year_id: year.id, version: 'English' } as any,
        TENANT_ID,
      );

      expect(bangla.id).not.toBe(english.id);
    });
  });
});
