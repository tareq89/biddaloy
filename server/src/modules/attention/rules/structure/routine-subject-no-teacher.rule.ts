import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from './role-recipients';

@AttentionRule()
export class RoutineSubjectNoTeacherRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('routine.subject_no_teacher');
  readonly messages = {
    en: {
      title: '{count} routine periods have no teacher',
      why: 'These periods are in the routine but nobody is assigned to teach them.',
      steps: [
        'Open Routines.',
        'Pick the class and section.',
        'Assign a teacher to every empty period.',
      ],
      action: 'Open routines',
    },
    bn: {
      title: 'রুটিনের {count}টি পিরিয়ডে কোনো শিক্ষক নেই',
      why: 'এই পিরিয়ডগুলো রুটিনে আছে, কিন্তু পড়ানোর জন্য কাউকে দেওয়া হয়নি।',
      steps: ['রুটিন খুলুন।', 'ক্লাস ও সেকশন বেছে নিন।', 'প্রতিটি খালি পিরিয়ডে শিক্ষক দিন।'],
      action: 'রুটিন খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n
       FROM routine_slots rs
       JOIN routines r ON r.id = rs.routine_id AND r.tenant_id = $1 AND r.deleted_at IS NULL
       JOIN academic_years y ON y.id = r.academic_year_id AND y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
       JOIN period_slots ps ON ps.id = rs.period_slot_id AND ps.tenant_id = $1 AND ps.kind = 'CLASS'
       JOIN class_sections cs ON cs.id = rs.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
       WHERE rs.tenant_id = $1 AND rs.valid_from <= $2 AND (rs.valid_to IS NULL OR rs.valid_to >= $2)
         AND NOT EXISTS (SELECT 1 FROM routine_slot_teachers rst WHERE rst.tenant_id = $1 AND rst.routine_slot_id = rs.id)`,
      [ctx.tenantId, ctx.localDate],
    );
    if (!row || row.n <= 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, [UserRole.ADMIN]);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.n },
        actionUrl: '/routines',
        recipients,
      },
    ];
  }
}
