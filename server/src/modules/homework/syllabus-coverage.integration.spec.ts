import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import type { StudyPlanLesson } from '@biddaloy/shared';
import { SyllabusService } from './syllabus.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { PlanScheduleService } from '../study-plans/plan-schedule.service';
import { StudyPlan } from '../study-plans/entities/study-plan.entity';
import { SyllabusTopic } from './entities/syllabus-topic.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';

/**
 * [66.2.07/D31] `SyllabusService.coverageFor` against a real DB. The plans,
 * sections and topics are real rows; the schedule is a stub that reports a
 * lesson DONE when its id is in `doneLessons` (the date mapping itself is
 * covered by `plan-schedule.service.integration.spec.ts`).
 */
describe('SyllabusService.coverageFor (integration)', () => {
  let service: SyllabusService;
  let dataSource: DataSource;

  const TENANT = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000095';
  const doneLessons = new Set<string>();
  const scheduleStub = {
    schedulesFor: async (plans: StudyPlan[]) =>
      new Map(
        plans.map((plan) => [
          plan.id,
          {
            raw: {
              lessons: plan.lessons.map((l) => ({
                id: l.id,
                status: doneLessons.has(l.id) ? 'DONE' : 'UPCOMING',
              })),
            },
          },
        ]),
      ),
  };

  let yearId: string;
  let classId: string;
  let sec1: string;
  let sec2: string;
  let sec3: string;
  let math: string;
  let topicT: string;
  let topicU: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      SyllabusService,
      { provide: PlanScheduleService, useValue: scheduleStub },
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
    yearId = (
      await dataSource.getRepository(AcademicYear).save({
        name: `Coverage ${Date.now()}`,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        tenant_id: TENANT,
      })
    ).id;
    classId = (
      await dataSource.getRepository(Class).save({
        name: 'COV 7',
        academic_year_id: yearId,
        tenant_id: TENANT,
        numeric_grade: 7,
      })
    ).id;
    const secRepo = dataSource.getRepository(ClassSection);
    sec1 = (await secRepo.save({ section_name: 'A', class_id: classId, tenant_id: TENANT })).id;
    sec2 = (await secRepo.save({ section_name: 'B', class_id: classId, tenant_id: TENANT })).id;
    sec3 = (await secRepo.save({ section_name: 'C', class_id: classId, tenant_id: TENANT })).id;
  }, 60000);

  // Subjects and topics are reset between tests, so rebuild them each time.
  beforeEach(async () => {
    math = (
      await dataSource.getRepository(Subject).save({
        tenant_id: TENANT,
        name_en: 'Cov Math',
        code: `COV-${Date.now()}`,
      })
    ).id;
    const topics = dataSource.getRepository(SyllabusTopic);
    topicT = (
      await topics.save({
        tenant_id: TENANT,
        class_id: classId,
        subject_id: math,
        name: 'T',
        sequence: 1,
      })
    ).id;
    topicU = (
      await topics.save({
        tenant_id: TENANT,
        class_id: classId,
        subject_id: math,
        name: 'U',
        sequence: 2,
      })
    ).id;
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function plan(
    sectionId: string,
    lessons: StudyPlanLesson[],
    tenantId = TENANT,
    termId: string | null = null,
  ) {
    return dataSource.getRepository(StudyPlan).save({
      tenant_id: tenantId,
      academic_year_id: yearId,
      academic_term_id: termId,
      section_id: sectionId,
      subject_id: math,
      lessons,
      exam_markers: [],
    });
  }

  it('counts sections planned and sections where every linked lesson is done', async () => {
    doneLessons.clear();
    // Section 1 links T and has finished it; section 2 links T but has not.
    await plan(sec1, [{ id: 'cov-a1', title: 'A1', periods: 1, topic_id: topicT }]);
    await plan(sec2, [{ id: 'cov-b1', title: 'B1', periods: 1, topic_id: topicT }]);
    // Section 3 has no plan at all.
    doneLessons.add('cov-a1');

    const cov = await service.coverageFor(classId, math, TENANT);

    expect(cov.get(topicT)).toEqual({ sections_planned: 2, sections_taught: 1 });
    // A topic no plan links is simply absent (the controller fills zeros).
    expect(cov.get(topicU)).toBeUndefined();
    expect(sec3).toBeTruthy();
  });

  it('ignores a soft-deleted plan', async () => {
    doneLessons.clear();
    const dead = await plan(sec3, [{ id: 'cov-c1', title: 'C1', periods: 1, topic_id: topicU }]);
    doneLessons.add('cov-c1');
    await dataSource.getRepository(StudyPlan).softDelete({ id: dead.id });

    const cov = await service.coverageFor(classId, math, TENANT);

    expect(cov.get(topicU)).toBeUndefined();
  });

  it('never counts another tenant plans', async () => {
    doneLessons.clear();
    // The tenant filter must hold even if a TENANT_B plan pointed at this class's section.
    const sectionE = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'E', class_id: classId, tenant_id: TENANT })
    ).id;
    await plan(sectionE, [{ id: 'cov-x1', title: 'X', periods: 1, topic_id: topicU }], TENANT_B);

    const cov = await service.coverageFor(classId, math, TENANT);

    expect(cov.get(topicU)).toBeUndefined();
  });

  it('a section with a year plan and a term plan counts once', async () => {
    doneLessons.clear();
    const sectionD = (
      await dataSource
        .getRepository(ClassSection)
        .save({ section_name: 'D', class_id: classId, tenant_id: TENANT })
    ).id;
    await plan(sectionD, [{ id: 'cov-d1', title: 'D1', periods: 1, topic_id: topicU }]);
    const term = await dataSource.query(
      `INSERT INTO academic_terms (id, tenant_id, academic_year_id, seq, name, start_date, end_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'Cov Term', '2026-01-01', '2026-06-30', NOW(), NOW()) RETURNING id`,
      [TENANT, yearId],
    );
    await plan(
      sectionD,
      [{ id: 'cov-d2', title: 'D2', periods: 1, topic_id: topicU }],
      TENANT,
      term[0].id,
    );
    doneLessons.add('cov-d1');

    const cov = await service.coverageFor(classId, math, TENANT);

    // Not every linked lesson of the section is done (cov-d2 is not).
    expect(cov.get(topicU)).toEqual({ sections_planned: 1, sections_taught: 0 });
  });
});
