import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AttendanceAccessService } from './attendance-access.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '@biddaloy/shared';

/**
 * Integration tests for `AttendanceAccessService` — the object-level "may
 * this caller touch this section?" gate. Runs against a real, migrated test
 * database (see `attendance-entities.integration.spec.ts`'s docstring for
 * why `dropSchema` specs are avoided in this module).
 *
 * `teachers`/`teacher_class_sections` are "transactional" tables — the
 * global `beforeEach` in `test/setup.ts` truncates them before *every*
 * test, unlike `schools`/`users`/`academic_years`/`classes`/`class_sections`
 * (reset once per *file*, per `test/reset-order.ts`). So the section/class
 * fixtures are created once in `beforeAll`, but every teacher and mapping
 * row is re-created in `beforeEach`, matching
 * `attendance-entities.integration.spec.ts`'s own pattern.
 */
describe('AttendanceAccessService (integration)', () => {
  let service: AttendanceAccessService;
  let dataSource: DataSource;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000099';

  let sectionA1Id: string;
  let sectionA2Id: string; // exists in tenant A; teacher A is never mapped to it
  let sectionB1Id: string; // same section_name as A1, in tenant B

  let teacherAUserId: string;
  let teacherAId: string;
  let teacherBUserId: string;
  let teacherBId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AttendanceAccessService]);
    service = module.get<AttendanceAccessService>(AttendanceAccessService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    async function seedSections(tenantId: string, sectionName: string) {
      if (!(await schoolRepo.findOne({ where: { id: tenantId } }))) {
        await schoolRepo.save({
          id: tenantId,
          name: tenantId,
          slug: `school-${tenantId.slice(-4)}`,
        });
      }
      // A distinct name from the file-level baseline seed's own
      // `SEED_ACADEMIC_YEAR_ID` ('2026-2027') — both exist for `TENANT_A`,
      // and `(name, tenant_id)` is unique.
      const year = await yearRepo.save({
        name: 'Attendance Access Test Year',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: tenantId,
      });
      const klass = await classRepo.save({
        name: 'Class 6',
        academic_year_id: year.id,
        tenant_id: tenantId,
      });
      const section1 = await sectionRepo.save({
        section_name: sectionName,
        class_id: klass.id,
        tenant_id: tenantId,
      });
      const section2 = await sectionRepo.save({
        section_name: `${sectionName}2`,
        class_id: klass.id,
        tenant_id: tenantId,
      });
      return { section1Id: section1.id, section2Id: section2.id };
    }

    const a = await seedSections(TENANT_A, 'A');
    sectionA1Id = a.section1Id;
    sectionA2Id = a.section2Id;

    const b = await seedSections(TENANT_B, 'A'); // deliberately the same name as tenant A's section 1
    sectionB1Id = b.section1Id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    const userRepo = dataSource.getRepository(User);
    const teacherRepo = dataSource.getRepository(Teacher);
    const tcsRepo = dataSource.getRepository(TeacherClassSection);

    async function seedTeacher(tenantId: string, sectionId: string) {
      const user = await userRepo.save({
        email: `teacher-${tenantId.slice(-4)}-${Date.now()}-${Math.random()}@test.com`,
        full_name: `Teacher ${tenantId.slice(-4)}`,
      });
      const teacher = await teacherRepo.save({
        user_id: user.id,
        employee_id: `EMP-${tenantId.slice(-4)}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: tenantId,
        designations: [],
      });
      await tcsRepo.save({
        teacher_id: teacher.id,
        section_id: sectionId,
        tenant_id: tenantId,
        subject_id: null,
      });
      return { userId: user.id, teacherId: teacher.id };
    }

    // Teacher A is mapped only to section A1, not A2.
    const a = await seedTeacher(TENANT_A, sectionA1Id);
    teacherAUserId = a.userId;
    teacherAId = a.teacherId;

    // Teacher B is mapped to the same-named section in tenant B.
    const b = await seedTeacher(TENANT_B, sectionB1Id);
    teacherBUserId = b.userId;
    teacherBId = b.teacherId;
  });

  describe('listMarkableSections', () => {
    it('gives a TEACHER only the sections they are mapped to', async () => {
      const sections = await service.listMarkableSections(
        UserRole.TEACHER,
        teacherAUserId,
        TENANT_A,
      );
      expect(sections.map((s) => s.id)).toEqual([sectionA1Id]);
    });

    it("does not leak tenant A's section to a same-named section's teacher in tenant B", async () => {
      const sections = await service.listMarkableSections(
        UserRole.TEACHER,
        teacherBUserId,
        TENANT_B,
      );
      expect(sections.map((s) => s.id)).toEqual([sectionB1Id]);
      expect(sections.map((s) => s.id)).not.toContain(sectionA1Id);
    });

    it('gives ADMIN every section in the tenant', async () => {
      const sections = await service.listMarkableSections(UserRole.ADMIN, teacherAUserId, TENANT_A);
      const ids = sections.map((s) => s.id);
      expect(ids).toContain(sectionA1Id);
      expect(ids).toContain(sectionA2Id);
      expect(ids).not.toContain(sectionB1Id);
    });

    it('gives an unrecognized role no sections at all', async () => {
      const sections = await service.listMarkableSections(
        'SOME_OTHER_ROLE',
        teacherAUserId,
        TENANT_A,
      );
      expect(sections).toEqual([]);
    });
  });

  describe('assertCanAccessSection', () => {
    it('allows a TEACHER to access their own mapped section', async () => {
      const section = await service.assertCanAccessSection(
        UserRole.TEACHER,
        teacherAUserId,
        sectionA1Id,
        TENANT_A,
      );
      expect(section.id).toBe(sectionA1Id);
    });

    it('403s a TEACHER attempting a section they are not mapped to', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.TEACHER, teacherAUserId, sectionA2Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it("403s tenant B's teacher attempting to use tenant A's X-Tenant-ID header against their own section id", async () => {
      // Cross-tenant probe: teacher B is genuinely mapped to sectionB1Id,
      // but calling with tenant A's id must find nothing.
      await expect(
        service.assertCanAccessSection(UserRole.TEACHER, teacherBUserId, sectionB1Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to access any section in the tenant', async () => {
      const section = await service.assertCanAccessSection(
        UserRole.ADMIN,
        teacherAUserId,
        sectionA2Id,
        TENANT_A,
      );
      expect(section.id).toBe(sectionA2Id);
    });

    it('403s ADMIN attempting a section outside their tenant', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.ADMIN, teacherAUserId, sectionB1Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403s a role with no attendance access at all (e.g. STUDENT)', async () => {
      await expect(
        service.assertCanAccessSection(UserRole.STUDENT, teacherAUserId, sectionA1Id, TENANT_A),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
