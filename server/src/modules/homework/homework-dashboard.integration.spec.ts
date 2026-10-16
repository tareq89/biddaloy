import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { SyllabusTopicStatus } from '@biddaloy/shared';
import { SyllabusService } from './syllabus.service';
import { PlanScheduleService } from '../study-plans/plan-schedule.service';
import { StudyPlanDashboardService } from '../study-plans/study-plan-dashboard.service';
import { SchoolsService } from '../schools/schools.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';

/** [8.10.7.2.05] `SyllabusService.progressByClass`: done / in-progress / total per class. */
const expectedStub = new Map<string, { expected_percentage: number; not_updated: number }>();

describe('SyllabusService.progressByClass (integration)', () => {
  beforeEach(() => expectedStub.clear());

  let service: SyllabusService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000098';
  let classA: string;
  let classEmpty: string;
  let classOld: string;
  let classB: string;

  const S = SyllabusTopicStatus;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SyllabusService,
      { provide: PlanScheduleService, useValue: {} },
      {
        provide: StudyPlanDashboardService,
        useValue: { expectedByClass: async () => expectedStub },
      },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => ({ region: { timezone: 'UTC' } }) },
      },
      TeacherScopeService,
      AuditService,
    ]);
    service = module.get(SyllabusService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  // test/setup.ts resets tables before every test, so seed here.
  beforeEach(async () => {
    const schoolRepo = dataSource.getRepository(School);
    for (const id of [TENANT, TENANT_B]) {
      if (!(await schoolRepo.findOne({ where: { id } }))) {
        await schoolRepo.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    await yearRepo.update({ tenant_id: TENANT }, { is_current: false });
    await yearRepo.update({ tenant_id: TENANT_B }, { is_current: false });
    // Years survive the per-test reset, so reuse them by name.
    const mkYear = async (tenant_id: string, name: string, is_current: boolean) => {
      const year =
        (await yearRepo.findOne({ where: { name, tenant_id } })) ??
        (await yearRepo.save({
          name,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          tenant_id,
        }));
      await yearRepo.update({ id: year.id }, { is_current });
      return year;
    };
    const cur = await mkYear(TENANT, 'Progress Cur', true);
    const old = await mkYear(TENANT, 'Progress Old', false);
    const curB = await mkYear(TENANT_B, 'Progress B', true);

    const classRepo = dataSource.getRepository(Class);
    const mkClass = async (name: string, academic_year_id: string, tenant_id: string) =>
      (
        (await classRepo.findOne({ where: { name, academic_year_id, tenant_id } })) ??
        (await classRepo.save({ name, academic_year_id, tenant_id }))
      ).id;
    classA = await mkClass('Prog A', cur.id, TENANT);
    classEmpty = await mkClass('Prog Empty', cur.id, TENANT);
    classOld = await mkClass('Prog Old', old.id, TENANT);
    classB = await mkClass('Prog B', curB.id, TENANT_B);

    const subjectRepo = dataSource.getRepository(Subject);
    const subj = async (tenant_id: string, code: string) =>
      (
        (await subjectRepo.findOne({ where: { tenant_id, code } })) ??
        (await subjectRepo.save({ tenant_id, name_en: code, code }))
      ).id;
    const subjA = await subj(TENANT, 'PROGA');
    const subjB = await subj(TENANT_B, 'PROGB');

    const topicRepo = dataSource.getRepository(SyllabusTopic);
    const add = (
      class_id: string,
      subject_id: string,
      tenant_id: string,
      status: SyllabusTopicStatus,
      sequence: number,
    ) =>
      topicRepo.save({ class_id, subject_id, tenant_id, status, sequence, name: `T${sequence}` });
    await add(classA, subjA, TENANT, S.DONE, 1);
    await add(classA, subjA, TENANT, S.DONE, 2);
    await add(classA, subjA, TENANT, S.IN_PROGRESS, 3);
    await add(classA, subjA, TENANT, S.PLANNED, 4);
    await add(classOld, subjA, TENANT, S.DONE, 1);
    await add(classB, subjB, TENANT_B, S.DONE, 1);
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  it('counts done / in_progress / total / percentage for a class', async () => {
    const { classes } = await service.progressByClass(TENANT);
    expect(classes.find((c) => c.class_id === classA)).toEqual({
      class_id: classA,
      class_name: 'Prog A',
      done: 2,
      in_progress: 1,
      total: 4,
      percentage: 50,
      expected_percentage: null,
    });
  });

  it('reconciles with the syllabus list grouped by status', async () => {
    const rows = await service.findAll(TENANT, classA);
    const by = (s: SyllabusTopicStatus) => rows.filter((r) => r.status === s).length;
    const a = (await service.progressByClass(TENANT)).classes.find((c) => c.class_id === classA)!;
    expect([a.done, a.in_progress, a.total]).toEqual([by(S.DONE), by(S.IN_PROGRESS), rows.length]);
  });

  it('omits last year classes and classes with no topics', async () => {
    const ids = (await service.progressByClass(TENANT)).classes.map((c) => c.class_id);
    expect(ids).not.toContain(classOld);
    expect(ids).not.toContain(classEmpty);
  });

  it('never mixes in another tenant', async () => {
    const a = await service.progressByClass(TENANT);
    expect(a.classes.map((c) => c.class_id)).not.toContain(classB);
    const b = await service.progressByClass(TENANT_B);
    expect(b.classes.map((c) => c.class_id)).toEqual([classB]);
    expect(b.overall).toEqual({ done: 1, total: 1, percentage: 100 });
  });

  it('overall is the summed counts; zeros when there is nothing', async () => {
    const a = await service.progressByClass(TENANT);
    const done = a.classes.reduce((n, c) => n + c.done, 0);
    const total = a.classes.reduce((n, c) => n + c.total, 0);
    expect(a.overall).toEqual({ done, total, percentage: Math.round((done / total) * 100) });
    const none = await service.progressByClass('00000000-0000-4000-8000-0000000000ee');
    expect(none).toEqual({
      classes: [],
      overall: { done: 0, total: 0, percentage: 0 },
      behind_count: 0,
    });
  });

  it('merges the plan expectation: 50 done vs 60 expected is behind by 10', async () => {
    expectedStub.set(classA, { expected_percentage: 60, not_updated: 3 });
    const res = await service.progressByClass(TENANT);
    expect(res.classes.find((c) => c.class_id === classA)?.expected_percentage).toBe(60);
    expect(res.behind_count).toBe(1);
    const vs = await service.syllabusVsPlan(TENANT);
    expect(vs.classes).toEqual([
      {
        class_id: classA,
        class_name: 'Prog A',
        done_percentage: 50,
        expected_percentage: 60,
        behind_by: 10,
        not_updated: 3,
      },
    ]);
    expect(vs).toMatchObject({ behind_count: 1, not_updated_count: 3 });
    // Reconciliation: same done % as the syllabus-progress card.
    expect(vs.classes[0]?.done_percentage).toBe(
      res.classes.find((c) => c.class_id === classA)?.percentage,
    );
  });

  it('a class ahead of its plan is not behind; a class without a plan is not listed', async () => {
    expectedStub.set(classA, { expected_percentage: 40, not_updated: 0 });
    const vs = await service.syllabusVsPlan(TENANT);
    expect(vs.classes[0]?.behind_by).toBe(0);
    expect(vs.behind_count).toBe(0);
    expectedStub.clear();
    expect((await service.syllabusVsPlan(TENANT)).classes).toEqual([]);
  });
});
