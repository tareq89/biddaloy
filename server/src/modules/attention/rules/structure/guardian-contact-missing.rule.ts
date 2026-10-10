import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from './role-recipients';

@AttentionRule()
export class GuardianContactMissingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('guardian.contact_missing');
  readonly messages = {
    en: {
      title: '{count} students have no guardian phone number',
      why: 'The school cannot reach these families by SMS — absence notices and fee reminders will not arrive.',
      steps: [
        'Open Guardians.',
        'Find guardians without a phone number.',
        'Add a phone number for each.',
      ],
      action: 'Open guardians',
    },
    bn: {
      title: '{count} জন শিক্ষার্থীর অভিভাবকের ফোন নম্বর নেই',
      why: 'এসএমএস দিয়ে এই পরিবারগুলোর সাথে যোগাযোগ করা যাচ্ছে না — অনুপস্থিতির নোটিশ ও ফি রিমাইন্ডার পৌঁছাবে না।',
      steps: [
        'অভিভাবক তালিকা খুলুন।',
        'যাঁদের ফোন নম্বর নেই তাঁদের খুঁজুন।',
        'প্রত্যেকের ফোন নম্বর যোগ করুন।',
      ],
      action: 'অভিভাবক তালিকা খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM students s
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM student_guardians sg
           JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
           WHERE sg.student_id = s.id
             AND (NULLIF(trim(g.phone), '') IS NOT NULL OR NULLIF(trim(g.alternate_phone), '') IS NOT NULL))`,
      [ctx.tenantId],
    );
    if (!row || row.n <= 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, [UserRole.ADMIN]);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.n },
        actionUrl: '/guardians',
        recipients,
      },
    ];
  }
}
