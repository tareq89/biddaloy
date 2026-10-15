import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { StudyPlanDashboardService } from './study-plan-dashboard.service';
import { StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';
import { SchoolsService } from '../schools/schools.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { StudyPlan } from './entities/study-plan.entity';

/**
 * [8.10.7.7.04] Real DB for plan selection (current year, whole-year plan,
 * tenant scope). The schedule math is `PlanScheduleService`'s own (covered in
 * plan-schedule.service.integration.spec.ts), so `summarize` is a stub here.
 */
describe('StudyPlanDashboardService.expectedByClass (integration)', () => {
  let ds: DataSource;
  let service: StudyPlanDashboardService;
  const TENANT = '00000000-0000-4000-8000-000001930001';
  const OTHER = '00000000-0000-4000-8000-000001930002';
  const summaries = new Map<string, object>();
  const summarize = vi.fn(async (plans: StudyPlan[]) => {
    return new Map(plans.map((p) => [p.id, summaries.get(p.subject_id)!]));
  });
  let tz = 'Asia/Dhaka';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      StudyPlanDashboardService,
      StudyPlansService,
      TeacherScopeService,
      AuditService,
      { provide: PlanScheduleService, useValue: { summarize } },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => ({ region: { timezone: tz } }) },
      },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(StudyPlanDashboardService);
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  let classA: string;
  let classNoPlan: string;
  let sectionA1: string;
  let sectionA2: string;
  let subjectX: string;
  let subjectY: string;
  let otherClass: string;
  let otherSection: string;

  const summary = (done: number, behind: number, total: number, unreported: number) => ({
    lessons_done: done,
    lessons_behind: behind,
    lessons_total: total,
    unreported_periods: unreported,
  });
  const plan = (tenant_id: string, year: string, section_id: string, subject_id: string) =>
    ds.getRepository(StudyPlan).save({
      tenant_id,
      academic_year_id: year,
      academic_term_id: null,
      section_id,
      subject_id,
      lessons: [{ id: 'l1', title: 'L1', periods: 1 }],
      exam_markers: [],
    });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T06:00:00Z'));
    summaries.clear();
    summarize.mockClear();
    tz = 'Asia/Dhaka';
    for (const id of [TENANT, OTHER]) {
      if (!(await ds.getRepository(School).findOne({ where: { id } }))) {
        await ds.getRepository(School).save({ id, name: id, slug: `sp-dash-${id.slice(-4)}` });
      }
    }
    const tag = Math.random().toString(36).slice(2, 8);
    const year = async (tenant_id: string) => {
      await ds.getRepository(AcademicYear).update({ tenant_id }, { is_current: false });
      return (
        await ds.getRepository(AcademicYear).save({
          tenant_id,
          name: `SP Dash ${tag}`,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          is_current: true,
        })
      ).id;
    };
    const [yearId, otherYear] = [await year(TENANT), await year(OTHER)];
    const mk = async (tenant_id: string, academic_year_id: string, name: string) => {
      const c = await ds.getRepository(Class).save({ tenant_id, academic_year_id, name });
      const sections: string[] = [];
      for (const s of ['A', 'B']) {
        sections.push(
          (
            await ds
              .getRepository(ClassSection)
              .save({ tenant_id, class_id: c.id, section_name: s })
          ).id,
        );
      }
      return { id: c.id, sections };
    };
    const a = await mk(TENANT, yearId, 'Eight');
    classA = a.id;
    [sectionA1, sectionA2] = a.sections as [string, string];
    classNoPlan = (await mk(TENANT, yearId, 'Nine')).id;
    const o = await mk(OTHER, otherYear, 'Eight');
    otherClass = o.id;
    otherSection = o.sections[0]!;
    const subj = async (tenant_id: string, code: string) =>
      (
        await ds
          .getRepository(Subject)
          .save({ tenant_id, code: `${code}${tag}`, name_en: code, name_bn: 'বি' })
      ).id;
    subjectX = await subj(TENANT, 'SPX');
    subjectY = await subj(TENANT, 'SPY');
    const subjectO = await subj(OTHER, 'SPO');

    await plan(TENANT, yearId, sectionA1, subjectX);
    await plan(TENANT, yearId, sectionA2, subjectY);
    await plan(OTHER, otherYear, otherSection, subjectO);
    summaries.set(subjectX, summary(4, 2, 10, 1)); // expected 6 of 10
    summaries.set(subjectY, summary(3, 0, 10, 2)); // expected 3 of 10
    summaries.set(subjectO, summary(0, 9, 10, 9)); // other tenant: must never show
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('class expected % = sum(done + behind) / sum(total); not_updated sums unreported periods', async () => {
    const out = await service.expectedByClass(TENANT);
    // (6 + 3) / 20 = 45%; 1 + 2 unreported
    expect(out.get(classA)).toEqual({ expected_percentage: 45, not_updated: 3 });
  });

  it('a class without a plan is absent (not counted behind)', async () => {
    const out = await service.expectedByClass(TENANT);
    expect(out.has(classNoPlan)).toBe(false);
  });

  it('tenant isolation: the other tenant class never appears', async () => {
    const out = await service.expectedByClass(TENANT);
    expect(out.has(otherClass)).toBe(false);
    const theirs = await service.expectedByClass(OTHER);
    expect([...theirs.keys()]).toEqual([otherClass]);
  });

  it('no plans at all returns an empty map without calling the schedule', async () => {
    await ds.query('DELETE FROM study_plans WHERE tenant_id = $1', [TENANT]);
    expect((await service.expectedByClass(TENANT)).size).toBe(0);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('a plan of a non-current year is ignored', async () => {
    await ds.query('UPDATE academic_years SET is_current = false WHERE tenant_id = $1', [TENANT]);
    expect((await service.expectedByClass(TENANT)).size).toBe(0);
  });

  it('"today" is the school-local date (Dhaka midnight moves it to the 8th)', async () => {
    {
      vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
      const spy = vi.spyOn(StudyPlansService.prototype, 'currentPlanFor');
      await service.expectedByClass(TENANT);
      expect(spy.mock.calls.every((c) => c[3] === '2026-10-08')).toBe(true);
      spy.mockClear();
      tz = 'UTC';
      await service.expectedByClass(TENANT);
      expect(spy.mock.calls.every((c) => c[3] === '2026-10-07')).toBe(true);
    }
  });
});
