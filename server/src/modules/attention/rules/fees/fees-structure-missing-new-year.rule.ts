import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { addDaysIso } from '../rule-context.service';
import { roleRecipients } from '../structure/role-recipients';

/** The next academic year starts soon and has no fee structure. */
@AttentionRule()
export class FeesStructureMissingNewYearRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('fees.structure_missing_new_year');
  readonly messages = {
    en: {
      title: 'No fee structures for {year}',
      why: 'The new academic year starts on {startDate}, but no fees are set up for it.',
      steps: ['Open Fee structures.', 'Choose {year}.', 'Add each fee with its amount.'],
      action: 'Open fee structures',
    },
    bn: {
      title: '{year} শিক্ষাবর্ষের কোনো ফি কাঠামো নেই',
      why: 'নতুন শিক্ষাবর্ষ শুরু হবে {startDate} তারিখে, কিন্তু তার জন্য কোনো ফি ঠিক করা হয়নি।',
      steps: ['ফি কাঠামো খুলুন।', '{year} বেছে নিন।', 'টাকার পরিমাণসহ প্রতিটি ফি যোগ করুন।'],
      action: 'ফি কাঠামো খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { id: string; name: string; start_date: string }[] = await this.dataSource.query(
      `SELECT n.id, n.name, to_char(n.start_date, 'YYYY-MM-DD') AS start_date
       FROM academic_years cur
       JOIN academic_years n ON n.tenant_id = $1 AND n.deleted_at IS NULL AND n.start_date > cur.start_date
       WHERE cur.tenant_id = $1 AND cur.is_current = true AND cur.deleted_at IS NULL
         AND n.start_date <= $2
         AND NOT EXISTS (SELECT 1 FROM fee_structures f WHERE f.tenant_id = $1 AND f.academic_year_id = n.id AND f.deleted_at IS NULL)
       ORDER BY n.start_date LIMIT 1`,
      // ponytail: 60-day lead is a constant; a setting when a school asks
      [ctx.tenantId, addDaysIso(ctx.localDate, 60)],
    );
    if (!row) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `academic_year:${row.id}`,
        subject: { type: 'academic_year', id: row.id },
        params: { year: row.name, startDate: row.start_date },
        actionUrl: '/fee-structures',
        recipients,
      },
    ];
  }
}
