import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CommunicationMedium,
  Permission,
  ROLE_PERMISSIONS,
  UserRole,
  UserStatus,
  roleHasPermission,
} from '@biddaloy/shared';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { PushService } from '../push/push.service';
import { CommunicationsService } from '../communications/communications.service';
import { INCIDENT_CREATED, IncidentCreatedEvent, incidentEvents } from './incidents.service';

/** The only text ever sent. Incident text (`body`) is never read here (D2). */
export const INCIDENT_NOTIFICATION_TEXT = 'New incident report';

const ACR_WRITE_ROLES = (Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter((r) =>
  roleHasPermission(r, Permission.ACR_WRITE),
);

/** Pushes a fixed string to every ACR_WRITE holder of the tenant; SMS only
 * when `settings.evaluations.incidentSmsEnabled === true` (default off). */
@Injectable()
export class IncidentNotifyListener implements OnModuleInit {
  private readonly logger = new Logger(IncidentNotifyListener.name);

  constructor(
    @InjectRepository(UserTenant) private readonly memberships: Repository<UserTenant>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly push: PushService,
    private readonly communications: CommunicationsService,
  ) {}

  onModuleInit(): void {
    incidentEvents.on(INCIDENT_CREATED, (event: IncidentCreatedEvent) => {
      void this.handleIncidentCreated(event).catch((error) =>
        this.logger.error(
          `incident.created handler failed for ${event.incidentId}`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
    });
  }

  async handleIncidentCreated({
    tenantId,
    staffUserId,
    reportedBy,
  }: IncidentCreatedEvent): Promise<void> {
    const holders = await this.memberships.find({
      where: { tenant_id: tenantId, role: In(ACR_WRITE_ROLES) },
      relations: { user: true },
    });
    const smsOn = await this.smsEnabled(tenantId);
    const skip = new Set([staffUserId, reportedBy]);
    // One notification per user even if they hold several memberships.
    const users = [...new Map(holders.map((h) => [h.user_id, h.user])).values()];

    for (const user of users) {
      // Null / inactive users and the subject or reporter are never notified.
      if (!user || user.status !== UserStatus.ACTIVE || skip.has(user.id)) continue;
      try {
        await this.notify(user, tenantId, reportedBy, smsOn);
      } catch (e) {
        // One bad recipient must not abort the rest.
        this.logger.warn(`incident notify failed: ${String(e)}`);
      }
    }
  }

  private async notify(
    user: User,
    tenantId: string,
    reportedBy: string,
    smsOn: boolean,
  ): Promise<void> {
    {
      await this.push
        .sendToUser(user.id, tenantId, {
          type: 'incident.created',
          title: INCIDENT_NOTIFICATION_TEXT,
          body: INCIDENT_NOTIFICATION_TEXT,
          url: '/incidents',
        })
        .catch((e) => this.logger.warn(`incident push failed: ${String(e)}`));
      if (smsOn && user.phone) {
        // ponytail: no SMS-credit reservation (fee listener reserves for metered tenants); add if incident SMS must be metered.
        await this.communications
          .enqueue(
            {
              medium: CommunicationMedium.SMS,
              recipient_address: user.phone,
              recipient_name: user.full_name,
              message_body: INCIDENT_NOTIFICATION_TEXT,
            },
            tenantId,
            reportedBy,
          )
          .catch((e) => this.logger.warn(`incident sms failed: ${String(e)}`));
      }
    }
  }

  /** Raw read: the resolved-settings type does not carry `evaluations`.
   * Also requires an SMS provider, like the fee listener's `smsAvailable`. */
  private async smsEnabled(tenantId: string): Promise<boolean> {
    const school = await this.schools.findOne({ where: { id: tenantId } });
    const settings = school?.settings;
    return (
      settings?.evaluations?.incidentSmsEnabled === true &&
      !!settings?.communications?.sms?.provider
    );
  }
}
