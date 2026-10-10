import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const WINDOW_MS = 72 * 3_600_000;

@AttentionRule()
export class LeaveMyRequestDecidedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('leave.my_request_decided');
  readonly messages = {
    en: {
      title: 'Your leave request was {decision_en}',
      why: 'Leave from {from} to {to}.',
      steps: ['Open Staff leave to see the details.'],
      action: 'See my leave',
    },
    bn: {
      title: 'আপনার ছুটির আবেদন {decision_bn}',
      why: 'ছুটি {from} থেকে {to} পর্যন্ত।',
      steps: ['বিস্তারিত দেখতে কর্মীর ছুটি পাতা খুলুন।'],
      action: 'আমার ছুটি দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: {
      id: string;
      status: string;
      start_date: string;
      end_date: string;
      decided_at: Date;
      user_id: string;
    }[] = await this.dataSource.query(
      `SELECT lr.id, lr.status::text AS status, to_char(lr.start_date,'YYYY-MM-DD') AS start_date,
              to_char(lr.end_date,'YYYY-MM-DD') AS end_date, lr.decided_at, sp.user_id
       FROM leave_records lr
       JOIN staff_profiles sp ON sp.id = lr.staff_profile_id AND sp.tenant_id = $1
       JOIN users u ON u.id = sp.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE lr.tenant_id = $1 AND lr.status IN ('APPROVED','REJECTED') AND lr.decided_at >= $2
         AND EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = sp.user_id AND ut.tenant_id = $1
                     AND ut.deleted_at IS NULL)`,
      [ctx.tenantId, new Date(ctx.now.getTime() - WINDOW_MS)],
    );
    return rows.map((r) => {
      const approved = r.status === 'APPROVED';
      return {
        dedupeKey: `leave_record:${r.id}`,
        subject: { type: 'leave_record', id: r.id },
        params: {
          from: r.start_date,
          to: r.end_date,
          decision_en: approved ? 'approved' : 'rejected',
          decision_bn: approved ? 'অনুমোদিত হয়েছে' : 'নামঞ্জুর হয়েছে',
        },
        expiresAt: new Date(new Date(r.decided_at).getTime() + WINDOW_MS),
        actionUrl: '/attendance/staff/leave',
        recipients: [{ userId: r.user_id, role: null }],
      };
    });
  }
}
