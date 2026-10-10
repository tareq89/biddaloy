import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

/**
 * This month's tuition run exists for some students but not all active current-year ones.
 * Tuition only: fines, exam or admission fees are billed to a few students on purpose.
 */
@AttentionRule()
export class FeesUnassignedStudentsRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.unassigned_students');
  readonly messages = {
    en: {
      title: '{missing} students have no fee for {month}',
      why: "This month's fees were generated, but these active students were left out.",
      steps: [
        'Open Fees › Generate.',
        'Pick {month} and the classes involved.',
        'Generate the missing fees.',
      ],
      action: 'Generate fees',
    },
    bn: {
      title: '{missing} জন শিক্ষার্থীর {month} মাসের ফি তৈরি হয়নি',
      why: 'এ মাসের ফি তৈরি হয়েছে, কিন্তু এই সক্রিয় শিক্ষার্থীরা বাদ পড়েছে।',
      steps: [
        'ফি › তৈরি করুন খুলুন।',
        '{month} মাস ও সংশ্লিষ্ট ক্লাস বেছে নিন।',
        'বাদ পড়া ফি তৈরি করুন।',
      ],
      action: 'ফি তৈরি করুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const month = ctx.localDate.slice(0, 7);
    const [row]: { generated: number; missing: number }[] = await this.dataSource.query(
      `WITH m AS (SELECT DISTINCT sf.student_id FROM student_fees sf
                  JOIN students s ON s.id = sf.student_id AND s.tenant_id = $1
                  JOIN fee_structures fs ON fs.id = sf.fee_structure_id AND fs.tenant_id = $1
                  WHERE sf.deleted_at IS NULL AND fs.fee_type = 'MONTHLY_TUITION'
                    AND sf.period_type = 'MONTH' AND sf.year = $2 AND sf.month = $3)
       SELECT (SELECT COUNT(*) FROM m)::int AS generated,
              COUNT(*)::int AS missing
       FROM students s
       JOIN class_sections cs ON cs.id = s.class_section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
       JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN academic_years y ON y.id = c.academic_year_id AND y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
         AND s.id NOT IN (SELECT student_id FROM m)`,
      [ctx.tenantId, Number(month.slice(0, 4)), Number(month.slice(5, 7))],
    );
    // No generation yet this month is not this rule's business.
    if (!row || row.generated === 0 || row.missing === 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}:${month}`,
        params: { missing: row.missing, month },
        actionUrl: '/fees/generate',
        recipients,
      },
    ];
  }
}
