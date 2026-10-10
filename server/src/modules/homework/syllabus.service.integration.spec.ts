import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { SyllabusTopicStatus, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { SyllabusService } from './syllabus.service';
import { PlanScheduleService } from '../study-plans/plan-schedule.service';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';

/**
 * Real-DB tests for the syllabus write scope (66.0 D16): a TEACHER writes only
 * a class x subject they teach as SUBJECT_TEACHER (any section of the class).
 */
describe('SyllabusService write scope (integration)', () => {
  let service: SyllabusService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000097';

  let class7: string;
  let class8: string;
  let sec7A: string;
  let sec7B: string;
  let math: string;
  let english: string;
  let userT: string; // SUBJECT_TEACHER Math in 7-B
  let userU: string; // no rows
  let userH: string; // CLASS_TEACHER of 7-A

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SyllabusService,
      { provide: PlanScheduleService, useValue: {} },
      TeacherScopeService,
      AuditService,
    ]);
    service = module.get(SyllabusService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT }, { is_current: false });
    const year = await yearRepo.save({
      name: 'Syllabus Scope',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
      tenant_id: TENANT,
    });
    const classRepo = dataSource.getRepository(Class);
    class7 = (
      await classRepo.save({
        name: 'Syl Class 7',
        academic_year_id: year.id,
        tenant_id: TENANT,
        numeric_grade: 7,
      })
    ).id;
    class8 = (
      await classRepo.save({
        name: 'Syl Class 8',
        academic_year_id: year.id,
        tenant_id: TENANT,
        numeric_grade: 8,
      })
    ).id;
    const secRepo = dataSource.getRepository(ClassSection);
    sec7A = (await secRepo.save({ section_name: 'A', class_id: class7, tenant_id: TENANT })).id;
    sec7B = (await secRepo.save({ section_name: 'B', class_id: class7, tenant_id: TENANT })).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function makeTeacher(tag: string): Promise<{ userId: string; teacherId: string }> {
    const user = await dataSource.getRepository(User).save({
      email: `syl-${tag}-${Date.now()}-${Math.random()}@test.com`,
      full_name: `Syl ${tag}`,
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `EMP-${tag}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: TENANT,
      designations: [],
    });
    return { userId: user.id, teacherId: teacher.id };
  }

  const assign = (
    teacherId: string,
    sectionId: string,
    type: TeacherAssignmentType,
    subjectId: string | null = null,
  ) =>
    dataSource.getRepository(TeacherClassSection).save({
      teacher_id: teacherId,
      section_id: sectionId,
      tenant_id: TENANT,
      subject_id: subjectId,
      assignment_type: type,
    });

  beforeEach(async () => {
    const subjectRepo = dataSource.getRepository(Subject);
    const mk = (code: string) =>
      subjectRepo.save({ tenant_id: TENANT, name_en: code, code }).then((s) => s.id);
    math = await mk('SYLMATH');
    english = await mk('SYLENG');

    const t = await makeTeacher('T');
    userT = t.userId;
    await assign(t.teacherId, sec7B, TeacherAssignmentType.SUBJECT_TEACHER, math);
    userU = (await makeTeacher('U')).userId;
    const h = await makeTeacher('H');
    userH = h.userId;
    await assign(h.teacherId, sec7A, TeacherAssignmentType.CLASS_TEACHER);
  });

  const TEACHER = UserRole.TEACHER;
  const ADMIN = UserRole.ADMIN;
  const topicRepo = () => dataSource.getRepository(SyllabusTopic);
  const seed = (classId: string, subjectId: string, name: string, sequence = 1) =>
    topicRepo().save({
      tenant_id: TENANT,
      class_id: classId,
      subject_id: subjectId,
      name,
      sequence,
      status: SyllabusTopicStatus.PLANNED,
    });
  const dto = (classId: string, subjectId: string) =>
    ({ class_id: classId, subject_id: subjectId, name: 'Topic', sequence: 1 }) as never;

  it('mapped teacher creates a topic for their class x subject, with an audit row', async () => {
    const saved = await service.create(dto(class7, math), TENANT, TEACHER, userT);
    expect(await topicRepo().findOneBy({ id: saved.id })).not.toBeNull();
    const audits = await dataSource
      .getRepository(AuditLog)
      .find({ where: { entity_id: saved.id, tenant_id: TENANT } });
    expect(audits).toHaveLength(1);
  });

  it('403 SYLLABUS_OUT_OF_SCOPE for another subject, no row written', async () => {
    const err = await service.create(dto(class7, english), TENANT, TEACHER, userT).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().details.code).toBe('SYLLABUS_OUT_OF_SCOPE');
    expect(await topicRepo().countBy({ tenant_id: TENANT, subject_id: english })).toBe(0);
  });

  it('403 for an unmapped teacher and for a homeroom-only teacher', async () => {
    await expect(service.create(dto(class7, math), TENANT, TEACHER, userU)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.create(dto(class7, math), TENANT, TEACHER, userH)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('update / delete own class x subject ok; other class 403 and row untouched', async () => {
    const own = await seed(class7, math, 'own');
    const other = await seed(class8, math, 'other');
    await service.update(own.id, { name: 'renamed' } as never, TENANT, TEACHER, userT);
    expect((await topicRepo().findOneByOrFail({ id: own.id })).name).toBe('renamed');
    await service.remove(own.id, TENANT, TEACHER, userT);
    expect(await topicRepo().findOneBy({ id: own.id })).toBeNull();

    await expect(
      service.update(other.id, { name: 'x' } as never, TENANT, TEACHER, userT),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove(other.id, TENANT, TEACHER, userT)).rejects.toThrow(
      ForbiddenException,
    );
    expect((await topicRepo().findOneByOrFail({ id: other.id })).name).toBe('other');
  });

  it('reorder is all-or-nothing across class x subject pairs', async () => {
    const a = await seed(class7, math, 'a', 1);
    const b = await seed(class7, math, 'b', 2);
    const e = await seed(class7, english, 'e', 3);
    await service.reorder(
      [
        { id: a.id, sequence: 2 },
        { id: b.id, sequence: 1 },
      ],
      TENANT,
      TEACHER,
      userT,
    );
    expect((await topicRepo().findOneByOrFail({ id: a.id })).sequence).toBe(2);

    await expect(
      service.reorder(
        [
          { id: a.id, sequence: 9 },
          { id: e.id, sequence: 8 },
        ],
        TENANT,
        TEACHER,
        userT,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect((await topicRepo().findOneByOrFail({ id: a.id })).sequence).toBe(2);
    expect((await topicRepo().findOneByOrFail({ id: e.id })).sequence).toBe(3);
  });

  it('ADMIN writes any class', async () => {
    const saved = await service.create(dto(class8, english), TENANT, ADMIN, userU);
    await service.update(saved.id, { name: 'n' } as never, TENANT, ADMIN, userU);
    await service.reorder([{ id: saved.id, sequence: 5 }], TENANT, ADMIN, userU);
    await service.remove(saved.id, TENANT, ADMIN, userU);
    expect(await topicRepo().findOneBy({ id: saved.id })).toBeNull();
  });

  it('SUPER_ADMIN still writes any class (not held out by hasTenantDataScope)', async () => {
    const saved = await service.create(dto(class8, english), TENANT, UserRole.SUPER_ADMIN, userU);
    await service.remove(saved.id, TENANT, UserRole.SUPER_ADMIN, userU);
    expect(await topicRepo().findOneBy({ id: saved.id })).toBeNull();
  });

  it("another tenant's topic id is 404, not 403, and unchanged", async () => {
    const other = await seed(class7, math, 'mine');
    await expect(service.remove(other.id, TENANT_B, TEACHER, userT)).rejects.toThrow(
      NotFoundException,
    );
    expect(await topicRepo().findOneBy({ id: other.id })).not.toBeNull();
  });
});
