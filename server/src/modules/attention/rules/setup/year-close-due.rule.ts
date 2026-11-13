import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import { addDaysIso } from '../rule-context.service';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const CLOSE_DUE_AFTER_DAYS = 60; // ponytail: constant, make it a setting when a school asks

/** A finished year (no longer current) that was never closed, with no draft promotion run still open (D21). */
@AttentionRule({ module: 'core' })
export class YearCloseDueRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('year.close_due');
  readonly messages = {
    en: {
      title: '{year} has ended but is not closed',
      why: '{year} ended on {endDate}. Until it is closed, its records can still be changed by mistake.',
      steps: ['Open the academic year.', 'Check the close checklist.', 'Press Close year.'],
      action: 'Close year',
    },
    bn: {
      title: '{year} শেষ হয়েছে কিন্তু বন্ধ করা হয়নি',
      why: '{year} শেষ হয়েছে {endDate} তারিখে। বন্ধ না করা পর্যন্ত এই বছরের তথ্য ভুলে বদলে যেতে পারে।',
      steps: ['শিক্ষাবর্ষটি খুলুন।', 'বন্ধ করার তালিকা দেখুন।', '"বছর বন্ধ করুন" চাপুন।'],
      action: 'বছর বন্ধ করুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: { id: string; name: string; end_date: string }[] = await this.dataSource.query(
      `SELECT y.id, y.name, to_char(y.end_date, 'YYYY-MM-DD') AS end_date
       FROM academic_years y
       WHERE y.tenant_id = $1 AND y.deleted_at IS NULL
         AND y.closed_at IS NULL AND y.is_current = false
         AND y.end_date <= $2::date
         AND NOT EXISTS (SELECT 1 FROM promotion_runs r WHERE r.tenant_id = $1
           AND r.source_academic_year_id = y.id AND r.status = 'DRAFT')
       ORDER BY y.end_date DESC`,
      [ctx.tenantId, addDaysIso(ctx.localDate, -CLOSE_DUE_AFTER_DAYS)],
    );
    if (!rows.length) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return rows.map((y) => ({
      dedupeKey: 'academic_year:' + y.id,
      subject: { type: 'academic_year', id: y.id },
      params: { year: y.name, endDate: y.end_date },
      actionUrl: '/academic-years/' + y.id,
      recipients,
    }));
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
