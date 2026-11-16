import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, CommunicationMedium, UserRole, ModuleKey } from '@biddaloy/shared';
import { SendLimitService } from '../../../communications/limits/send-limit.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

// One word per channel for both languages: `params` are shared by en and bn.
const LABEL: Partial<Record<CommunicationMedium, string>> = {
  [CommunicationMedium.SMS]: 'SMS',
  [CommunicationMedium.EMAIL]: 'Email',
  [CommunicationMedium.WHATSAPP]: 'WhatsApp',
};

/** [60.0 D13, D18, D20] Tells admins a daily send limit stopped their messages. */
@AttentionRule({ module: ModuleKey.messaging })
export class CommsDailyLimitReachedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('comms.daily_limit_reached');
  readonly messages = {
    en: {
      title: "Today's {channel} limit is reached",
      why: 'This school has sent {limit} {channel} messages today, which is the daily limit. More {channel} messages will not go out until tomorrow.',
      steps: [
        'Wait until tomorrow; the count starts again at midnight.',
        'Open Communication › Message log to see which messages did not go.',
        'If the school needs to send more every day, contact the platform team.',
      ],
      action: 'Open message log',
    },
    bn: {
      title: 'আজকের {channel} পাঠানোর দিনের সীমা শেষ',
      why: 'এই স্কুল আজ {limit}টি {channel} পাঠিয়েছে, এটাই দিনের সীমা। আগামীকালের আগে আর {channel} যাবে না।',
      steps: [
        'আগামীকাল পর্যন্ত অপেক্ষা করুন; মধ্যরাতে গণনা আবার শুরু হয়।',
        'যোগাযোগ › বার্তার তালিকা খুলে দেখুন কোন বার্তা যায়নি।',
        'প্রতিদিন বেশি পাঠানোর দরকার হলে প্ল্যাটফর্ম টিমের সাথে যোগাযোগ করুন।',
      ],
      action: 'বার্তার তালিকা দেখুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly limits: SendLimitService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const hit = await this.limits.hitToday(ctx.tenantId);
    if (!hit.length) return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    // The alert is not blocked by the limit it reports: in-app delivery is not a send. If the
    // engine also pushes it by SMS/email, that goes through the registry and may be refused;
    // accepted, the in-app alert is the guarantee.
    return Promise.all(
      hit.map(async (medium) => ({
        // localDate is the school's (Dhaka) calendar day: once per channel per day.
        dedupeKey: 'school:' + ctx.tenantId + ':' + medium + ':' + ctx.localDate,
        subject: { type: 'school', id: ctx.tenantId },
        params: {
          channel: LABEL[medium] ?? medium,
          limit: (await this.limits.remaining(ctx.tenantId, medium)).limit,
        },
        actionUrl: '/communications/batches',
        recipients,
      })),
    );
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
