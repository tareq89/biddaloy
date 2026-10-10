import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { roleRecipients } from '../structure/role-recipients';

@AttentionRule()
export class AdmissionApplicationsPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('admission.applications_pending');
  readonly messages = {
    en: {
      title: '{count} admission applications are waiting',
      why: 'They are still PENDING — families are waiting for an answer.',
      steps: [
        'Open Admissions › Applicants.',
        'Review each application.',
        'Shortlist, admit or reject it.',
      ],
      action: 'Review applications',
    },
    bn: {
      title: '{count}টি ভর্তির আবেদন অপেক্ষায় আছে',
      why: 'এগুলো এখনো বিবেচনাধীন — পরিবারগুলো উত্তরের অপেক্ষায়।',
      steps: ['ভর্তি › আবেদনকারী খুলুন।', 'প্রতিটি আবেদন দেখুন।', 'বাছাই, ভর্তি বা বাতিল করুন।'],
      action: 'আবেদন দেখুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const [row]: { n: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM admission_applicants a
       JOIN admission_intakes i ON i.id = a.intake_id AND i.tenant_id = $1 AND i.deleted_at IS NULL
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.status = 'PENDING'`,
      [ctx.tenantId],
    );
    if (!row || row.n <= 0) return [];
    const recipients = await roleRecipients(this.dataSource, ctx.tenantId, this.meta.roles);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: `school:${ctx.tenantId}`,
        params: { count: row.n },
        actionUrl: '/admissions/applicants',
        recipients,
      },
    ];
  }
}
