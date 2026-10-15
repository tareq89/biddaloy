import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { localToday } from '../attendance/attendance-policy.util';
import { SchoolsService } from '../schools/schools.service';
import { StudyPlan } from './entities/study-plan.entity';
import { StudyPlansService } from './study-plans.service';
import { PlanScheduleService } from './plan-schedule.service';

/** Planned pace of one class, summed over its sections' current plans. */
export interface ClassExpected {
  /** round(expected lessons / total lessons * 100). */
  expected_percentage: number;
  /** Past routine periods with no delivery report. */
  not_updated: number;
}

/**
 * [8.10.7.7.04] Dashboard-side reads of the study-plan schedule (D1: dates are
 * never stored, so "expected by today" always comes from `PlanScheduleService`).
 */
@Injectable()
export class StudyPlanDashboardService {
  constructor(
    @InjectRepository(StudyPlan) private readonly planRepo: Repository<StudyPlan>,
    private readonly plans: StudyPlansService,
    private readonly schedule: PlanScheduleService,
    private readonly schools: SchoolsService,
  ) {}

  /**
   * Per class of the current year that has at least one current plan:
   * expected % by today and the not-updated period count. Classes without a
   * plan are absent from the map.
   */
  async expectedByClass(tenantId: string): Promise<Map<string, ClassExpected>> {
    const pairs = await this.planRepo
      .createQueryBuilder('p')
      .innerJoin(
        ClassSection,
        'cs',
        'cs.id = p.section_id AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
      )
      .innerJoin(
        Class,
        'c',
        'c.id = cs.class_id AND c.tenant_id = :tenantId AND c.deleted_at IS NULL',
      )
      .innerJoin(
        AcademicYear,
        'ay',
        'ay.id = c.academic_year_id AND ay.tenant_id = :tenantId AND ay.is_current = true',
      )
      .select('p.section_id', 'section_id')
      .addSelect('p.subject_id', 'subject_id')
      .addSelect('c.id', 'class_id')
      .where('p.tenant_id = :tenantId', { tenantId })
      .distinct(true)
      .getRawMany<{ section_id: string; subject_id: string; class_id: string }>();
    if (!pairs.length) return new Map();

    const settings = await this.schools.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const current = await Promise.all(
      pairs.map(async (p) => ({
        classId: p.class_id,
        plan: await this.plans.currentPlanFor(tenantId, p.section_id, p.subject_id, today),
      })),
    );
    const live = current.filter((c): c is { classId: string; plan: StudyPlan } => !!c.plan);
    const summaries = await this.schedule.summarize(
      live.map((c) => c.plan),
      tenantId,
    );

    const sums = new Map<string, { expected: number; total: number; notUpdated: number }>();
    for (const { classId, plan } of live) {
      const s = summaries.get(plan.id);
      if (!s) continue;
      const acc = sums.get(classId) ?? { expected: 0, total: 0, notUpdated: 0 };
      acc.expected += s.lessons_done + Math.max(s.lessons_behind, 0);
      acc.total += s.lessons_total;
      acc.notUpdated += s.unreported_periods;
      sums.set(classId, acc);
    }
    const out = new Map<string, ClassExpected>();
    for (const [classId, a] of sums) {
      if (a.total === 0) continue;
      out.set(classId, {
        expected_percentage: Math.round((a.expected / a.total) * 100),
        not_updated: a.notUpdated,
      });
    }
    return out;
  }
}
