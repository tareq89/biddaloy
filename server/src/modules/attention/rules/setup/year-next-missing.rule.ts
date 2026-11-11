import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const NEXT_YEAR_LEAD_DAYS = 45; // ponytail: constant, make it a setting when a school asks

@AttentionRule()
export class YearNextMissingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('year.next_missing');
  readonly messages = {
    en: {
      title: 'Next academic year is not created',
      why: "{year} ends on {endDate}. Next year's classes, routine and fees need the year to exist first.",
      steps: [
        'Open Academic years.',
        'Add the next year with its start and end dates.',
        'Then set up its classes and fees.',
      ],
      action: 'Open academic years',
    },
    bn: {
      title: 'পরের শিক্ষাবর্ষ এখনো তৈরি হয়নি',
      why: '{year} শেষ হবে {endDate} তারিখে। পরের বছরের ক্লাস, রুটিন ও ফি ঠিক করতে আগে শিক্ষাবর্ষটি তৈরি করতে হবে।',
      steps: [
        'শিক্ষাবর্ষ পাতা খুলুন।',
        'শুরু ও শেষের তারিখসহ পরের শিক্ষাবর্ষ যোগ করুন।',
        'এরপর সেই বছরের ক্লাস ও ফি ঠিক করুন।',
      ],
      action: 'শিক্ষাবর্ষ খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; name: string; end_date: string }[] = await this.dataSource.query(
      `SELECT y.id, y.name, to_char(y.end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years y
       WHERE y.tenant_id = $1 AND y.is_current = true AND y.deleted_at IS NULL
         AND y.end_date <= $2::date
         AND NOT EXISTS (SELECT 1 FROM academic_years n WHERE n.tenant_id = $1
           AND n.deleted_at IS NULL AND n.start_date > y.start_date)`,
      [ctx.tenantId, addDaysIso(ctx.localDate, NEXT_YEAR_LEAD_DAYS)],
    );
    if (!rows.length) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    const y = rows[0];
    return [
      {
        dedupeKey: 'academic_year:' + y.id,
        subject: { type: 'academic_year', id: y.id },
        params: { year: y.name, endDate: y.end_date },
        actionUrl: '/academic-years',
        recipients,
      },
    ];
  }

  private async admins(tenantId: string): Promise<RuleFinding['recipients']> {
    const rows: { userId: string; role: UserRole }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (ut.user_id) ut.user_id AS "userId", ut.role::text AS role
       FROM user_tenants ut
       JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
       ORDER BY ut.user_id, array_position($2::text[], ut.role::text)`,
      [tenantId, this.meta.roles],
    );
    return rows.map((r) => ({ userId: r.userId, role: r.role }));
  }
}
