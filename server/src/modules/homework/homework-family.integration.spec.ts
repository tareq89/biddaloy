import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  EnrollmentStatus,
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  UserRole,
} from '@biddaloy/shared';
import { localToday } from '../../common/time';
import { HomeworkService } from './homework.service';
import { HomeworkAccessService } from './homework-access.service';
import { HomeworkNoticeService } from './homework-notice.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';

/** [8.10.7.4.14] `HomeworkService.findForStudent`: what a family caller sees for one child. */
describe('HomeworkService.findForStudent (integration)', () => {
  let service: HomeworkService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000189b01';
  const TODAY = '2026-10-07';
  const S = HomeworkAssignmentStatus;

  let sectionA: string;
  let sectionOther: string;
  let sectionB: string;
  let studentId: string;
  let classA: string;
  let subjectId: string;
  let subjectB: string;
  let classB: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      HomeworkService,
      { provide: HomeworkAccessService, useValue: { canManageTenantWide: () => true } },
      { provide: HomeworkNoticeService, useValue: {} },
    ]);
    service = module.get(HomeworkService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    vi.useRealTimers();
    await dataSource?.destroy();
  });

  // test/setup.ts resets tables before every test, so seed here.
  beforeEach(async () => {
    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Fam ${Math.random()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT,
    });
    const yearB = await dataSource.getRepository(AcademicYear).save({
      name: `FamB ${Math.random()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });
    const classRepo = dataSource.getRepository(Class);
    classA = (await classRepo.save({ name: 'Fam 6', academic_year_id: year.id, tenant_id: TENANT }))
      .id;
    classB = (
      await classRepo.save({ name: 'Fam B', academic_year_id: yearB.id, tenant_id: TENANT_B })
    ).id;
    const secRepo = dataSource.getRepository(ClassSection);
    sectionA = (await secRepo.save({ section_name: 'A', class_id: classA, tenant_id: TENANT })).id;
    sectionOther = (await secRepo.save({ section_name: 'B', class_id: classA, tenant_id: TENANT }))
      .id;
    sectionB = (await secRepo.save({ section_name: 'A', class_id: classB, tenant_id: TENANT_B }))
      .id;
    const subjRepo = dataSource.getRepository(Subject);
    subjectId = (
      await subjRepo.save({
        tenant_id: TENANT,
        name_en: 'Mathematics',
        name_bn: 'গণিত',
        code: `M${Math.random()}`.slice(0, 8),
      })
    ).id;
    subjectB = (
      await subjRepo.save({
        tenant_id: TENANT_B,
        name_en: 'Physics',
        code: `P${Math.random()}`.slice(0, 8),
      })
    ).id;
    studentId = (
      await dataSource.getRepository(Student).save({
        full_name: 'Kid',
        registration_number: `FAM-${Math.random()}`.slice(0, 12),
        roll_number: 1,
        class_section_id: sectionA,
        tenant_id: TENANT,
        enrollment_status: EnrollmentStatus.ACTIVE,
      })
    ).id;
  });

  async function assign(
    target: { section_id?: string; student_id?: string },
    due: string,
    opts: {
      assigned?: string;
      status?: HomeworkAssignmentStatus;
      title?: string;
      tenant?: string;
      subject?: string;
      classId?: string;
    } = {},
  ): Promise<string> {
    const hw = await dataSource.getRepository(Homework).save({
      tenant_id: opts.tenant ?? TENANT,
      subject_id: opts.subject ?? subjectId,
      class_id: opts.classId ?? classA,
      title: opts.title ?? 'HW',
      grading_mode: HomeworkGradingMode.MARKS,
    });
    return (
      await dataSource.getRepository(HomeworkAssignment).save({
        tenant_id: opts.tenant ?? TENANT,
        homework_id: hw.id,
        section_id: target.section_id ?? null,
        student_id: target.student_id ?? null,
        assigned_date: opts.assigned ?? '2026-10-06',
        due_date: due,
        status: opts.status ?? S.ACTIVE,
      })
    ).id;
  }

  const ids = async () =>
    (await service.findForStudent(TENANT, studentId, TODAY)).items.map((i) => i.assignment_id);

  it('lists a section assignment due tomorrow, with the documented shape', async () => {
    const id = await assign({ section_id: sectionA }, '2026-10-08', { title: 'অনুশীলনী ৫.২' });
    const res = await service.findForStudent(TENANT, studentId, TODAY);
    expect(res.today).toBe(TODAY);
    expect(res.items).toEqual([
      {
        assignment_id: id,
        title: 'অনুশীলনী ৫.২',
        description: null,
        subject_name_en: 'Mathematics',
        subject_name_bn: 'গণিত',
        assigned_date: '2026-10-06',
        due_date: '2026-10-08',
      },
    ]);
  });

  it('lists a student-targeted assignment and one due today', async () => {
    const direct = await assign({ student_id: studentId }, '2026-10-09');
    const dueToday = await assign({ section_id: sectionA }, TODAY, { assigned: TODAY });
    expect(await ids()).toEqual([dueToday, direct]);
  });

  it('hides another section, a student-targeted row for someone else', async () => {
    await assign({ section_id: sectionOther }, '2026-10-08');
    const other = await dataSource.getRepository(Student).save({
      full_name: 'Sibling',
      registration_number: `FAM2-${Math.random()}`.slice(0, 12),
      roll_number: 2,
      class_section_id: sectionOther,
      tenant_id: TENANT,
      enrollment_status: EnrollmentStatus.ACTIVE,
    });
    await assign({ student_id: other.id }, '2026-10-08');
    expect(await ids()).toEqual([]);
  });

  it('hides due-yesterday and assigned-tomorrow', async () => {
    await assign({ section_id: sectionA }, '2026-10-06');
    await assign({ section_id: sectionA }, '2026-10-12', { assigned: '2026-10-08' });
    expect(await ids()).toEqual([]);
  });

  it('hides DEACTIVATED and SUPERSEDED', async () => {
    await assign({ section_id: sectionA }, '2026-10-08', { status: S.DEACTIVATED });
    await assign({ section_id: sectionA }, '2026-10-08', { status: S.SUPERSEDED });
    expect(await ids()).toEqual([]);
  });

  it('sorts by due_date then assigned_date and caps at 50', async () => {
    const late = await assign({ section_id: sectionA }, '2026-10-20');
    const early2 = await assign({ section_id: sectionA }, '2026-10-08', { assigned: '2026-10-06' });
    const early1 = await assign({ section_id: sectionA }, '2026-10-08', { assigned: '2026-10-01' });
    expect(await ids()).toEqual([early1, early2, late]);
    for (let i = 0; i < 52; i++) await assign({ section_id: sectionA }, '2026-11-01');
    expect((await ids()).length).toBe(50);
  });

  it('tenant isolation: tenant B assignments never appear, even targeting this student id', async () => {
    await assign({ section_id: sectionB }, '2026-10-08', {
      tenant: TENANT_B,
      subject: subjectB,
      classId: classB,
    });
    await assign({ student_id: studentId }, '2026-10-08', {
      tenant: TENANT_B,
      subject: subjectB,
      classId: classB,
    });
    expect(await ids()).toEqual([]);
    // Asking as tenant B for a tenant A student finds nothing.
    expect((await service.findForStudent(TENANT_B, studentId, TODAY)).items).toEqual([]);
  });

  it('soft-deleted student sees nothing (ticket: student must have deleted_at IS NULL)', async () => {
    await assign({ section_id: sectionA }, '2026-10-08');
    await dataSource.getRepository(Student).softDelete({ id: studentId });
    expect(await ids()).toEqual([]);
  });

  it('TRANSFERRED (not deleted, i.e. withdrawn) student still resolves by section: the route does not filter enrollment', async () => {
    const id = await assign({ section_id: sectionA }, '2026-10-08');
    await dataSource
      .getRepository(Student)
      .update({ id: studentId }, { enrollment_status: EnrollmentStatus.TRANSFERRED });
    expect(await ids()).toEqual([id]);
  });

  it('reconciles with HomeworkService.findAll for the same section', async () => {
    await assign({ section_id: sectionA }, '2026-10-08');
    await assign({ section_id: sectionA }, '2026-10-09');
    const admin = { role: UserRole.ADMIN, userId: 'x', tenantId: TENANT };
    const adminList = await service.findAll({ section_id: sectionA }, admin);
    const adminIds = new Set(adminList.map((h) => h.id));
    const rows = await dataSource
      .getRepository(HomeworkAssignment)
      .find({ where: { id: undefined, section_id: sectionA } });
    const hwOfAssignment = new Map(rows.map((r) => [r.id, r.homework_id]));
    for (const a of await ids()) expect(adminIds.has(hwOfAssignment.get(a) as string)).toBe(true);
    expect((await ids()).length).toBe(2);
  });

  it('Dhaka midnight: 18:30Z on 6 Oct is already 7 Oct, so a 6 Oct due date is gone', async () => {
    const stale = await assign({ section_id: sectionA }, '2026-10-06');
    const fresh = await assign({ section_id: sectionA }, '2026-10-07');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-06T18:30:00Z'));
      const today = localToday('Asia/Dhaka');
      expect(today).toBe('2026-10-07');
      const res = await service.findForStudent(TENANT, studentId, today);
      expect(res.today).toBe('2026-10-07');
      expect(res.items.map((i) => i.assignment_id)).toEqual([fresh]);
      expect(res.items.map((i) => i.assignment_id)).not.toContain(stale);
    } finally {
      vi.useRealTimers();
    }
  });
});
