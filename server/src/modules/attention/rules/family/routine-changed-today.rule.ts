import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { ResolveRoutineService } from '../../../routines/resolve-routine.service';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings } from './family-data';

/** Today's periods that were cancelled or given to a substitute, per child's section. */
@AttentionRule()
export class RoutineChangedTodayRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('routine.changed_today');
  readonly messages = {
    en: {
      title: "{studentName}'s routine changed today",
      why: '{sectionLabel}: {cancelled} periods cancelled, {covered} with a substitute teacher.',
      steps: ["Check today's routine."],
      action: 'See routine',
    },
    bn: {
      title: 'আজ {studentName}-এর রুটিনে পরিবর্তন',
      why: '{sectionLabel}: {cancelled}টি পিরিয়ড বাতিল, {covered}টিতে বদলি শিক্ষক।',
      steps: ['আজকের রুটিন দেখুন।'],
      action: 'রুটিন দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
    private readonly resolveRoutine: ResolveRoutineService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const slots = await this.resolveRoutine.resolveTenantDay(ctx.tenantId, ctx.localDate);
    const bySection = new Map<string, { cancelled: number; covered: number }>();
    for (const s of slots) {
      if (!s.cancelled && !s.substituted) continue;
      const c = bySection.get(s.section_id) ?? { cancelled: 0, covered: 0 };
      if (s.cancelled) c.cancelled++;
      else c.covered++;
      bySection.set(s.section_id, c);
    }
    if (!bySection.size) return [];
    const students: { id: string; class_section_id: string }[] = await this.dataSource.query(
      `SELECT id, class_section_id FROM students
       WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'
         AND class_section_id = ANY($2::uuid[])`,
      [ctx.tenantId, [...bySection.keys()]],
    );
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      students.map((s) => ({
        studentId: s.id,
        dedupeKey: `student:${s.id}:${ctx.localDate}`,
        params: { ...bySection.get(s.class_section_id)! },
        expiresAt,
        actionUrl: `/portal/routine?student=${s.id}`,
      })),
    );
  }
}
