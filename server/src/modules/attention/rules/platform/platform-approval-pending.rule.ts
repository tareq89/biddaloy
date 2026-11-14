import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { PlatformHomeService } from '../../../platform-identity/platform-home.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { platformAdminRecipients } from './platform-admin-recipients';

/** Plain words for the scopes an owner can ask the other owner to approve. */
const SCOPE_LABELS: Record<string, string> = {
  'platform.owner_lock': 'lock an owner',
  'platform.owner_unlock': 'unlock an owner',
  'platform.approvals_switch': 'turn two-person approval off',
  'platform.approval_decide': 'decide an approval',
  'platform.recovery_codes': 'make new recovery codes',
};

@AttentionRule({ module: 'core' })
export class PlatformApprovalPendingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.approval_pending');
  readonly messages = {
    en: {
      title: '{who} is waiting for your approval',
      why: '{who} asks to: {what}. The request expires in 24 hours.',
      steps: ['Open Approvals.', 'Approve or deny the request.'],
      action: 'Open approvals',
    },
    bn: {
      title: '{who} আপনার অনুমোদনের অপেক্ষায় আছেন',
      why: '{who} অনুরোধ করেছেন: {what}। অনুরোধটি ২৪ ঘণ্টায় মেয়াদোত্তীর্ণ হবে।',
      steps: ['অনুমোদন পাতা খুলুন।', 'অনুরোধটি অনুমোদন বা প্রত্যাখ্যান করুন।'],
      action: 'অনুমোদন খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly home: PlatformHomeService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const homeId = await this.home.id();
    if (!homeId || ctx.tenantId !== homeId) return [];
    const owners = await platformAdminRecipients(this.dataSource);
    if (!owners.length) return [];

    const rows: {
      id: string;
      scope: string;
      requestedBy: string;
      fullName: string | null;
      expiresAt: Date;
    }[] = await this.dataSource.query(
      `SELECT a.id, a.scope, a.requested_by AS "requestedBy", u.full_name AS "fullName", a.expires_at AS "expiresAt"
           FROM platform_approvals a JOIN users u ON u.id = a.requested_by
          WHERE a.status = 'PENDING' AND a.expires_at > $1
          ORDER BY a.created_at`,
      [ctx.now],
    );
    const findings: RuleFinding[] = [];
    for (const r of rows) {
      // Only the OTHER owner can decide, so only they hear about it.
      const recipients = owners.filter((o) => o.userId !== r.requestedBy);
      if (!recipients.length) continue;
      findings.push({
        dedupeKey: `platform:approval:${r.id}`,
        params: {
          who: (r.fullName ?? '').trim().split(/\s+/)[0] || 'The other owner',
          what: SCOPE_LABELS[r.scope] ?? 'make a change',
        },
        actionUrl: '/platform-owners?tab=approvals',
        recipients,
        expiresAt: r.expiresAt,
      });
    }
    return findings;
  }
}
