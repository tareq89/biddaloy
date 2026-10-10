import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { FamilyAccessService } from '../../../students/family-access.service';
import { AttentionRule } from '../attention-rule.decorator';
import { endOfLocalDay } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { childFindings } from './family-data';

/** Absent in a FINALIZED whole-day register today (same "a human finalized it" rule as the absence-notice sweep). */
@AttentionRule()
export class ChildAbsentTodayRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('child.absent_today');
  readonly messages = {
    en: {
      title: '{studentName} is absent today',
      why: "Today's attendance for {sectionLabel} marks {studentName} absent.",
      steps: [
        'If this is wrong, contact the class teacher.',
        'If your child is unwell, let the school know.',
      ],
      action: 'See attendance',
    },
    bn: {
      title: '{studentName} আজ অনুপস্থিত',
      why: 'আজ {sectionLabel}-এর উপস্থিতিতে {studentName}-কে অনুপস্থিত দেখানো হয়েছে।',
      steps: ['ভুল হলে শ্রেণিশিক্ষকের সাথে যোগাযোগ করুন।', 'সন্তান অসুস্থ হলে স্কুলকে জানান।'],
      action: 'উপস্থিতি দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly family: FamilyAccessService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    if (!ctx.isWorkingDay) return [];
    const rows: { student_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT r.student_id FROM attendance_records r
       JOIN attendance_sessions s ON s.id = r.session_id AND s.tenant_id = $1 AND s.date = $2
         AND s.period_no IS NULL AND s.state = 'FINALIZED'
       JOIN students st ON st.id = r.student_id AND st.tenant_id = $1 AND st.deleted_at IS NULL
       WHERE r.tenant_id = $1 AND r.status = 'ABSENT'`,
      [ctx.tenantId, ctx.localDate],
    );
    const expiresAt = endOfLocalDay(ctx.localDate, ctx.tz);
    return childFindings(
      this.dataSource,
      this.family,
      ctx.tenantId,
      this.meta,
      rows.map((r) => ({
        studentId: r.student_id,
        dedupeKey: `student:${r.student_id}:${ctx.localDate}`,
        actionUrl: `/portal/attendance?student=${r.student_id}`,
        expiresAt,
      })),
      true, // D29: guardians without a login get the SMS fallback
    );
  }
}
