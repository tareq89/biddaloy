import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { TeacherAssignmentType } from '@biddaloy/shared';
import { TeacherScopeService } from './teacher-scope.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';

/**
 * Integration tests for `TeacherScopeService` against a real, migrated DB.
 * Years/classes/sections are created once per file; teachers, subjects and
 * assignment rows are "transactional" (truncated before every test by
 * `test/setup.ts`) so they are re-created in `beforeEach`.
 */
describe('TeacherScopeService (integration)', () => {
  let service: TeacherScopeService;
  let dataSource: DataSource;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000098';

  let sec6A: string; // Class 6 / A, current year
  let sec6B: string; // Class 6 / B, current year
  let sec7A: string; // Class 7 / A, current year
  let secDeleted: string; // soft-deleted section, current year
  let secOld: string; // section of a past (non-current) year
  let secB: string; // tenant B section

  let userId: string;
  let teacherId: string;
  let liveSubjectId: string;
  let deletedSubjectId: string;
  let otherSubjectId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [TeacherScopeService]);
    service = module.get(TeacherScopeService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    for (const id of [TENANT_A, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    // Only one current year per tenant; make ours the one.
    await yearRepo.update({ tenant_id: TENANT_A }, { is_current: false });

    const makeYear = (tenantId: string, name: string, isCurrent: boolean) =>
      yearRepo.save({
        name,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: isCurrent,
        tenant_id: tenantId,
      });
    const makeClass = (tenantId: string, yearId: string, name: string) =>
      classRepo.save({ name, academic_year_id: yearId, tenant_id: tenantId });
    const makeSection = (tenantId: string, classId: string, name: string) =>
      sectionRepo.save({ section_name: name, class_id: classId, tenant_id: tenantId });

    const currentA = await makeYear(TENANT_A, 'Scope Current', true);
    const pastA = await makeYear(TENANT_A, 'Scope Past', false);
    const class6 = await makeClass(TENANT_A, currentA.id, 'Class 6');
    const class7 = await makeClass(TENANT_A, currentA.id, 'Class 7');
    const classOld = await makeClass(TENANT_A, pastA.id, 'Class Old');
    sec6A = (await makeSection(TENANT_A, class6.id, 'A')).id;
    sec6B = (await makeSection(TENANT_A, class6.id, 'B')).id;
    sec7A = (await makeSection(TENANT_A, class7.id, 'A')).id;
    const deleted = await makeSection(TENANT_A, class6.id, 'Z');
    secDeleted = deleted.id;
    await sectionRepo.softDelete({ id: deleted.id });
    secOld = (await makeSection(TENANT_A, classOld.id, 'A')).id;

    const currentB = await makeYear(TENANT_B, 'Scope Current B', true);
    const classB = await makeClass(TENANT_B, currentB.id, 'Class 6');
    secB = (await makeSection(TENANT_B, classB.id, 'A')).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    const user = await dataSource.getRepository(User).save({
      email: `scope-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Scope Teacher',
    });
    userId = user.id;
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: userId,
      employee_id: `EMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: TENANT_A,
      designations: [],
    });
    teacherId = teacher.id;

    const subjectRepo = dataSource.getRepository(Subject);
    const makeSubject = (code: string) =>
      subjectRepo.save({ tenant_id: TENANT_A, name_en: code, code }).then((s) => s.id);
    liveSubjectId = await makeSubject('LIVE');
    deletedSubjectId = await makeSubject('GONE');
    otherSubjectId = await makeSubject('OTHER');
    await subjectRepo.softDelete({ id: deletedSubjectId });
  });

  const assign = (
    type: TeacherAssignmentType,
    sectionId: string,
    subjectId: string | null = null,
    over: { teacher_id?: string; tenant_id?: string } = {},
  ) =>
    dataSource.getRepository(TeacherClassSection).save({
      teacher_id: over.teacher_id ?? teacherId,
      section_id: sectionId,
      tenant_id: over.tenant_id ?? TENANT_A,
      subject_id: subjectId,
      assignment_type: type,
    });

  describe('rolesInSection', () => {
    const ask = (sectionId: string, tenantId = TENANT_A, user = userId) =>
      service.rolesInSection({ userId: user, tenantId, sectionId });

    it('reports CLASS_TEACHER', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6A)).toEqual({
        homeroom: TeacherAssignmentType.CLASS_TEACHER,
        subjectIds: [],
      });
    });

    it('reports ASSISTANT_CLASS_TEACHER', async () => {
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec6A);
      expect(await ask(sec6A)).toEqual({
        homeroom: TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
        subjectIds: [],
      });
    });

    it('reports SUBJECT_TEACHER subjects, and homeroom + subjects together', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, otherSubjectId);
      const result = await ask(sec6A);
      expect(result.homeroom).toBe(TeacherAssignmentType.CLASS_TEACHER);
      expect(result.subjectIds.sort()).toEqual([liveSubjectId, otherSubjectId].sort());
    });

    it('reports nothing for a section the teacher is not mapped to', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6B)).toEqual({ homeroom: null, subjectIds: [] });
    });

    it('excludes a soft-deleted subject (D16)', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, deletedSubjectId);
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect((await ask(sec6A)).subjectIds).toEqual([liveSubjectId]);
    });

    it("never shows another teacher's rows", async () => {
      const otherUser = await dataSource
        .getRepository(User)
        .save({ email: `scope-other-${Date.now()}@test.com`, full_name: 'Other' });
      const otherTeacher = await dataSource.getRepository(Teacher).save({
        user_id: otherUser.id,
        employee_id: `EMP-O-${Date.now()}`,
        tenant_id: TENANT_A,
        designations: [],
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A, null, {
        teacher_id: otherTeacher.id,
      });
      expect(await ask(sec6A)).toEqual({ homeroom: null, subjectIds: [] });
    });

    it("tenant isolation: tenant A's rows are invisible when asking as tenant B", async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
      expect(await ask(sec6A, TENANT_B)).toEqual({ homeroom: null, subjectIds: [] });
    });
  });

  describe('homeroomSections', () => {
    const list = (tenantId = TENANT_A, user = userId) =>
      service.homeroomSections({ userId: user, tenantId });

    it('returns CLASS and ASSISTANT sections ordered class then section, with names', async () => {
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec7A);
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6B);
      await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec6A);
      const rows = await list();
      expect(rows).toEqual([
        {
          section_id: sec6A,
          section_name: 'A',
          class_id: expect.any(String),
          class_name: 'Class 6',
          assignment_type: TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
        },
        expect.objectContaining({
          section_id: sec6B,
          assignment_type: TeacherAssignmentType.CLASS_TEACHER,
        }),
        expect.objectContaining({ section_id: sec7A, class_name: 'Class 7' }),
      ]);
    });

    it('returns [] for a subject-only teacher', async () => {
      await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
      expect(await list()).toEqual([]);
    });

    it('excludes a past-year section', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secOld);
      expect(await list()).toEqual([]);
    });

    it('excludes a soft-deleted section', async () => {
      await assign(TeacherAssignmentType.CLASS_TEACHER, secDeleted);
      expect(await list()).toEqual([]);
    });

    it("tenant isolation: another tenant's rows are invisible", async () => {
      // A different user (`teachers.user_id` is globally unique) teaching in
      // tenant B, mapped to tenant B's section.
      const userB = await dataSource
        .getRepository(User)
        .save({ email: `scope-b-${Date.now()}@test.com`, full_name: 'Teacher B' });
      const teacherB = await dataSource.getRepository(Teacher).save({
        user_id: userB.id,
        employee_id: `EMP-B-${Date.now()}`,
        tenant_id: TENANT_B,
        designations: [],
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, secB, null, {
        teacher_id: teacherB.id,
        tenant_id: TENANT_B,
      });
      await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);

      expect((await list(TENANT_A)).map((r) => r.section_id)).toEqual([sec6A]);
      // Teacher A asking as tenant B, and teacher B asking as tenant A: nothing.
      expect(await list(TENANT_B)).toEqual([]);
      expect(await list(TENANT_A, userB.id)).toEqual([]);
      expect((await list(TENANT_B, userB.id)).map((r) => r.section_id)).toEqual([secB]);
    });
  });
});
