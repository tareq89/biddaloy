import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, Permission, roleHasPermission } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class LeaveStaffPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('leave.staff_pending');
  readonly messages = {
    en: {
      title: '{count} staff leave requests need a decision',
      why: "The earliest starts on {firstStart}. Staff can't plan until you decide.",
      steps: ['Open Staff leave.', 'Approve or reject each request.'],
      action: 'Open leave requests',
    },
    bn: {
      title: '{count}টি কর্মী ছুটির আবেদনে সিদ্ধান্ত বাকি',
      why: 'প্রথমটি শুরু {firstStart} তারিখে। সিদ্ধান্ত না পেলে কর্মীরা পরিকল্পনা করতে পারছেন না।',
      steps: ['কর্মীর ছুটি পাতা খুলুন।', 'প্রতিটি আবেদন অনুমোদন বা নামঞ্জুর করুন।'],
      action: 'ছুটির আবেদন খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { n: number; first_start: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n, to_char(MIN(start_date), 'YYYY-MM-DD') AS first_start
       FROM leave_records WHERE tenant_id = $1 AND status = 'PENDING'`,
      [ctx.tenantId],
    );
    if (!row || row.n <= 0) return [];
    const approvers = this.meta.roles.filter((r) => roleHasPermission(r, Permission.LEAVE_APPROVE));
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, approvers);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.n, firstStart: row.first_start },
        actionUrl: '/attendance/staff/leave',
        recipients,
      },
    ];
  }
}
