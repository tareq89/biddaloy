import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import { AdminNoticeKey, NoticeLocale, NoticeVars, renderNotice } from './admin-notice-templates';

/**
 * SMS + email to every ADMIN of a school (trial warnings, trial ended, welcome). Sent through the
 * tenant's own provider, with the platform env fallback the providers already apply. One bad
 * address never blocks the rest; every attempt is logged in `communication_logs`.
 */
@Injectable()
export class AdminNoticeService {
  private readonly logger = new Logger(AdminNoticeService.name);

  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    @InjectRepository(CommunicationLog) private readonly logs: Repository<CommunicationLog>,
    private readonly registry: CommunicationProviderRegistryService,
  ) {}

  async notifyAdmins(
    schoolId: string,
    key: AdminNoticeKey,
    vars: Omit<NoticeVars, 'school'> = {},
  ): Promise<void> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) return;
    const locale: NoticeLocale = school.settings?.region?.locale === 'bn' ? 'bn' : 'en';
    const { subject, body } = renderNotice(key, locale, { ...vars, school: school.name });

    const admins = await this.memberships.find({
      where: { tenant_id: schoolId, role: UserRole.ADMIN },
      relations: ['user'],
    });

    for (const admin of admins) {
      // Only live accounts: a deactivated admin must not get school notices.
      if (admin.user?.status !== UserStatus.ACTIVE) continue;
      const targets: { medium: CommunicationMedium; to: string | null | undefined }[] = [
        { medium: CommunicationMedium.EMAIL, to: admin.user?.email },
        { medium: CommunicationMedium.SMS, to: admin.user?.phone },
      ];
      for (const { medium, to } of targets) {
        if (to) await this.send(schoolId, medium, to, admin.user.full_name, key, subject, body);
      }
    }
  }

  private async send(
    tenantId: string,
    medium: CommunicationMedium,
    to: string,
    recipientName: string,
    key: AdminNoticeKey,
    subject: string,
    body: string,
  ): Promise<void> {
    let status = CommunicationStatus.FAILED;
    let providerMessageId: string | null = null;
    try {
      const provider = this.registry.resolve(medium);
      if (provider) {
        const result = await provider.send({ to, body, subject }, tenantId);
        if (result.success) {
          status = CommunicationStatus.SENT;
          providerMessageId = result.providerMessageId;
        }
      }
    } catch {
      this.logger.error(`Admin notice ${key} (${medium}) failed for tenant ${tenantId}`);
    }
    try {
      await this.logs.save(
        this.logs.create({
          tenant_id: tenantId,
          medium,
          recipient_address: to,
          recipient_name: recipientName,
          message_body: body,
          subject,
          status,
          trigger: CommunicationTrigger.AUTOMATED,
          provider_message_id: providerMessageId,
          metadata: { kind: key },
        }),
      );
    } catch {
      this.logger.error(`Could not log admin notice ${key} for tenant ${tenantId}`);
    }
  }
}
