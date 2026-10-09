import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { alertRuleMeta, AlertSeverity, SchoolStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { DAY_MS, TRIAL_WARNINGS } from '../../../schools/trial/trial.constants';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

const WARN_FROM = Math.max(...TRIAL_WARNINGS.map((w) => w.days));
const URGENT_FROM = Math.min(...TRIAL_WARNINGS.map((w) => w.days));

/** One alert per trial: WARNING from 7 days out, CRITICAL from 2 days out (same dedupe key). */
@AttentionRule()
export class TrialEndingRule implements AttentionRuleShape {
  meta = alertRuleMeta('trial.ending');
  messages = {
    en: {
      title: 'Free trial: {days} days left',
      why: 'When the trial ends the school is paused until you choose a plan.',
      steps: ['Open the trial details', 'Choose a plan or contact support'],
      action: 'See trial details',
    },
    bn: {
      title: 'ফ্রি ট্রায়াল: আর {days} দিন বাকি',
      why: 'ট্রায়াল শেষ হলে প্ল্যান না নেওয়া পর্যন্ত স্কুলের কাজ বন্ধ থাকবে।',
      steps: ['ট্রায়ালের তথ্য খুলুন', 'একটি প্ল্যান বাছুন বা সহায়তায় যোগাযোগ করুন'],
      action: 'ট্রায়ালের তথ্য দেখুন',
    },
  };

  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const school = await this.schools.findOne({
      where: { id: ctx.tenantId, status: SchoolStatus.ACTIVE },
    });
    if (!school?.trial_ends_at) return [];

    // Same formula as TrialService.warn.
    const daysLeft = Math.ceil((school.trial_ends_at.getTime() - ctx.now.getTime()) / DAY_MS);
    if (daysLeft > WARN_FROM) return [];

    const admins = await this.memberships.find({
      // Explicit: a joined relation's soft-delete is not filtered on every TypeORM 0.3.x.
      where: { tenant_id: ctx.tenantId, role: UserRole.ADMIN, user: { deleted_at: IsNull() } },
      relations: ['user'],
    });
    const recipients = admins
      .filter((a) => a.user?.status === UserStatus.ACTIVE)
      .map((a) => ({ userId: a.user_id, role: UserRole.ADMIN }));
    if (!recipients.length) return [];

    return [
      {
        dedupeKey: 'trial',
        params: { days: Math.max(daysLeft, 0) },
        actionUrl: '/dashboard?trial=1',
        severity: daysLeft <= URGENT_FROM ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        expiresAt: new Date(school.trial_ends_at.getTime() + DAY_MS),
        recipients,
      },
    ];
  }
}
