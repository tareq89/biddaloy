import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const blank = (v: string | null) => !v || !v.trim();

/** Guardians with a portal login missing a phone, or both an email and a second phone. */
@AttentionRule()
export class GuardianProfileIncompleteRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('guardian.profile_incomplete');
  readonly messages = {
    en: {
      title: 'Your contact details are incomplete',
      why: 'Missing: {missing_en}. The school may not reach you in an emergency.',
      steps: ['Open My account.', 'Add the missing details and save.'],
      action: 'Open my account',
    },
    bn: {
      title: 'আপনার যোগাযোগের তথ্য অসম্পূর্ণ',
      why: 'নেই: {missing_bn}। জরুরি প্রয়োজনে স্কুল আপনার সাথে যোগাযোগ করতে না-ও পারে।',
      steps: ['আমার অ্যাকাউন্ট খুলুন।', 'বাদ পড়া তথ্য দিয়ে সংরক্ষণ করুন।'],
      action: 'আমার অ্যাকাউন্ট খুলুন',
    },
  };

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const rows: {
      id: string;
      user_id: string;
      phone: string | null;
      email: string | null;
      alternate_phone: string | null;
    }[] = await this.dataSource.query(
      `SELECT g.id, g.user_id, g.phone, g.email, g.alternate_phone
       FROM guardians g
       JOIN users u ON u.id = g.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE g.tenant_id = $1 AND g.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = g.user_id AND ut.tenant_id = $1
                     AND ut.role = 'PARENT' AND ut.deleted_at IS NULL)
         AND EXISTS (SELECT 1 FROM student_guardians sg
                     JOIN students s ON s.id = sg.student_id AND s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
                     WHERE sg.guardian_id = g.id)
         AND (NULLIF(trim(g.phone), '') IS NULL
              OR (NULLIF(trim(g.email), '') IS NULL AND NULLIF(trim(g.alternate_phone), '') IS NULL))`,
      [ctx.tenantId],
    );
    return rows.map((g) => {
      const en: string[] = [];
      const bn: string[] = [];
      if (blank(g.phone)) {
        en.push('phone number');
        bn.push('ফোন নম্বর');
      }
      if (blank(g.email) && blank(g.alternate_phone)) {
        en.push('email or second phone');
        bn.push('ইমেইল বা দ্বিতীয় ফোন নম্বর');
      }
      return {
        dedupeKey: `guardian:${g.id}`,
        subject: { type: 'guardian', id: g.id },
        params: { missing_en: en.join(', '), missing_bn: bn.join(', ') },
        actionUrl: '/portal/account',
        recipients: [{ userId: g.user_id, role: UserRole.PARENT }],
      };
    });
  }
}
