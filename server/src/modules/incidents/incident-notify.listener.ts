import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CommunicationMedium,
  Permission,
  ROLE_PERMISSIONS,
  UserRole,
  UserStatus,
  countSmsSegments,
  roleHasPermission,
} from '@biddaloy/shared';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { User } from '../users/entities/user.entity';
import { School } from '../schools/entities/school.entity';
import { PushService } from '../push/push.service';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
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
    private readonly smsCredit: SmsCreditService,
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
    incidentId,
    tenantId,
    staffUserId,
    reportedBy,
  }: IncidentCreatedEvent): Promise<void> {
    const holders = await this.memberships.find({
      where: { tenant_id: tenantId, role: In(ACR_WRITE_ROLES) },
      relations: { user: true },
    });
    const skip = new Set([staffUserId, reportedBy]);
    // One notification per user even if they hold several memberships.
    const users = [...new Map(holders.map((h) => [h.user_id, h.user])).values()];

    const recipients = users.filter((u) => u && u.status === UserStatus.ACTIVE && !skip.has(u.id));
    const sms = await this.reserveSms(
      tenantId,
      incidentId,
      recipients.filter((u) => u.phone).length,
    );

    for (const user of recipients) {
      // Null / inactive users and the subject or reporter are never notified.
      try {
        await this.notify(user, tenantId, reportedBy, sms);
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
    sms: SmsPlan,
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
      if (sms.on && user.phone) {
        // ponytail: if `enqueue` throws BEFORE `queue.add` (e.g. the log save
        // fails) this recipient's share stays reserved (reconciliation case).
        // Don't release here: once `queue.add` fails, enqueue already releases.
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
            sms.reservation,
          )
          .catch((e) => this.logger.warn(`incident sms failed: ${String(e)}`));
      }
    }
  }

  /**
   * SMS is sent only when the tenant opted in AND has a provider (like the
   * fee listener's `smsAvailable`). For a metered tenant the whole incident's
   * units are reserved once (same shape as the fee listener's batch
   * reservation); on insufficient credit or any error SMS is skipped, push
   * still goes out and the incident create is never affected.
   */
  private async reserveSms(
    tenantId: string,
    incidentId: string,
    smsRecipients: number,
  ): Promise<SmsPlan> {
    try {
      const school = await this.schools.findOne({ where: { id: tenantId } });
      const settings = resolveTenantSettings(school?.settings ?? null);
      if (
        settings.evaluations?.incidentSmsEnabled !== true ||
        !settings.communications?.sms?.provider ||
        smsRecipients === 0
      ) {
        return { on: false };
      }
      if (!(await this.smsCredit.isMetered(tenantId))) return { on: true };

      const segments = countSmsSegments(INCIDENT_NOTIFICATION_TEXT).segments;
      // The worker settles under `batch:${batchId}`, so the RESERVE key is that
      // prefixed form while `enqueue` gets the bare batchId.
      const batchId = `incident:${incidentId}`;
      const reserveKey = `batch:${batchId}`;
      const reservation = await this.smsCredit.reserve(
        tenantId,
        segments * smsRecipients,
        reserveKey,
        {
          type: 'batch',
          id: incidentId,
        },
      );
      return reservation.ok
        ? { on: true, reservation: { batchId, segments, reserveKey } }
        : { on: false };
    } catch (e) {
      this.logger.warn(`incident sms setup failed: ${String(e)}`);
      return { on: false };
    }
  }
}

/** `reservation` is set only for a metered tenant. */
interface SmsPlan {
  on: boolean;
  reservation?: { batchId: string; segments: number; reserveKey: string };
}
