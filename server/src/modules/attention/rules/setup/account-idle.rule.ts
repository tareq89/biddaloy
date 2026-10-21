import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { alertRuleMeta, AlertSeverity, SchoolStatus, UserRole, UserStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { TenantStatusService } from '../../../schools/tenant-status.service';
import { getSeatUsage } from '../../../schools/trial/seat-limit.service';
import {
  IDLE_SUSPEND_DAY,
  IDLE_URGENT_DAY,
  IDLE_WARN_DAY,
  idleAgeDays,
  idleClock,
} from '../../../billing/idle-account.constants';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

/** One alert per idle school: WARNING from day 20, CRITICAL from day 27 (same dedupe key). */
@AttentionRule()
export class AccountIdleRule implements AttentionRuleShape {
  meta = alertRuleMeta('account.idle');
  messages = {
    en: {
      // Count last, so 1 and 0 days read right without plural forms.
      title: 'Add a student to keep your school open: {days} days left',
      why: 'A school with no student after 30 days is paused.',
      steps: ['Add your first student', 'Need more time? Contact us'],
      action: 'Add a student',
    },
    bn: {
      title: 'স্কুল চালু রাখতে শিক্ষার্থী যোগ করুন: আর {days} দিন বাকি',
      why: '৩০ দিনেও কোনো শিক্ষার্থী না থাকলে স্কুল সাময়িক বন্ধ হয়ে যায়।',
      steps: ['প্রথম শিক্ষার্থী যোগ করুন', 'আরও সময় লাগলে আমাদের সঙ্গে যোগাযোগ করুন'],
      action: 'শিক্ষার্থী যোগ করুন',
    },
  };

  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // The platform console never has students and is never suspended for it.
    if (ctx.tenantId === (await this.tenantStatus.platformTenantId())) return [];
    const school = await this.schools.findOne({
      where: { id: ctx.tenantId, status: SchoolStatus.ACTIVE },
    });
    if (!school) return [];

    const age = idleAgeDays(idleClock(school.created_at, school.status_changed_at), ctx.now);
    if (age < IDLE_WARN_DAY) return [];
    if ((await getSeatUsage(this.schools.manager, ctx.tenantId)).used > 0) return [];
    // Same as the idle job: a school that has paid for seats is not abandoned.
    const paid = await this.schools.manager.query(
      `SELECT 1 FROM seat_orders WHERE school_id = $1 AND status = 'PAID' LIMIT 1`,
      [ctx.tenantId],
    );
    if (paid.length > 0) return [];

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
        dedupeKey: 'idle',
        params: { days: Math.max(IDLE_SUSPEND_DAY - age, 0) },
        actionUrl: '/students/new',
        severity: age >= IDLE_URGENT_DAY ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        recipients,
      },
    ];
  }
}
