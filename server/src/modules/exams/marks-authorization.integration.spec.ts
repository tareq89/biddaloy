import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { MarksAuthorizationService } from './marks-authorization.util';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';

/**
 * `MarksAuthorizationService` wired to the REAL `TeacherScopeService` and DB:
 * checks the join + live-subject filter + decision together (the unit spec
 * stubs the scope service). Teachers/subjects/assignments are truncated
 * before each test, so they are re-created in `beforeEach`.
 */
describe('MarksAuthorizationService with real TeacherScopeService (integration)', () => {
  let authz: MarksAuthorizationService;
  let dataSource: DataSource;
  const TENANT = SEED_TENANT_ID;

  let sec6A: string;
  let sec6B: string;
  let userId: string;
  let teacherId: string;
  let liveSubjectId: string;
  let deletedSubjectId: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [TeacherScopeService]);
    dataSource = module.get<DataSource>(getDataSourceToken());
    authz = new MarksAuthorizationService(module.get(TeacherScopeService));

    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Marks Authz Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Class 6', academic_year_id: year.id, tenant_id: TENANT });
    const sectionRepo = dataSource.getRepository(ClassSection);
    sec6A = (await sectionRepo.save({ section_name: 'A', class_id: klass.id, tenant_id: TENANT }))
      .id;
    sec6B = (await sectionRepo.save({ section_name: 'B', class_id: klass.id, tenant_id: TENANT }))
      .id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    const user = await dataSource
      .getRepository(User)
      .save({ email: `authz-${Date.now()}-${Math.random()}@test.com`, full_name: 'Authz Teacher' });
    userId = user.id;
    teacherId = (
      await dataSource.getRepository(Teacher).save({
        user_id: userId,
        employee_id: `EMP-AZ-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: TENANT,
        designations: [],
      })
    ).id;
    const subjectRepo = dataSource.getRepository(Subject);
    liveSubjectId = (await subjectRepo.save({ tenant_id: TENANT, name_en: 'Live', code: 'AZL' }))
      .id;
    deletedSubjectId = (await subjectRepo.save({ tenant_id: TENANT, name_en: 'Gone', code: 'AZG' }))
      .id;
    await subjectRepo.softDelete({ id: deletedSubjectId });
  });

  const assign = (
    type: TeacherAssignmentType,
    sectionId: string,
    subjectId: string | null = null,
  ) =>
    dataSource.getRepository(TeacherClassSection).save({
      teacher_id: teacherId,
      section_id: sectionId,
      tenant_id: TENANT,
      subject_id: subjectId,
      assignment_type: type,
    });

  const call = (sectionId: string, subjectId: string) => ({
    role: UserRole.TEACHER,
    userId,
    tenantId: TENANT,
    sectionId,
    subjectId,
  });

  it('CLASS teacher reads a subject they do not teach but cannot write it', async () => {
    await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
    await expect(authz.assertCanRead(call(sec6A, liveSubjectId))).resolves.toBeUndefined();
    await expect(authz.assertCanWrite(call(sec6A, liveSubjectId))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('ASSISTANT teacher reads a subject they do not teach', async () => {
    await assign(TeacherAssignmentType.ASSISTANT_CLASS_TEACHER, sec6A);
    await expect(authz.assertCanRead(call(sec6A, liveSubjectId))).resolves.toBeUndefined();
  });

  it('SUBJECT teacher of a soft-deleted subject is denied both read and write', async () => {
    await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, deletedSubjectId);
    await expect(authz.assertCanRead(call(sec6A, deletedSubjectId))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(authz.assertCanWrite(call(sec6A, deletedSubjectId))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('CLASS teacher of 6A cannot read 6B', async () => {
    await assign(TeacherAssignmentType.CLASS_TEACHER, sec6A);
    await expect(authz.assertCanRead(call(sec6B, liveSubjectId))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('SUBJECT teacher of a live subject reads and writes it', async () => {
    await assign(TeacherAssignmentType.SUBJECT_TEACHER, sec6A, liveSubjectId);
    await expect(authz.assertCanRead(call(sec6A, liveSubjectId))).resolves.toBeUndefined();
    await expect(authz.assertCanWrite(call(sec6A, liveSubjectId))).resolves.toBeUndefined();
  });
});
