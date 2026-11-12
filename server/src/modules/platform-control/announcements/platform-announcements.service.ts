import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AlertSeverity,
  ApprovalScope,
  AuditAction,
  CommunicationMedium,
  SchoolStatus,
} from '@biddaloy/shared';
import { AccountAccessDeliveryService } from '../../account-access/account-access-delivery.service';
import { AuditService } from '../../audit/audit.service';
import { ManualAlertsService } from '../../attention/manual/manual-alerts.service';
import { addDaysIso } from '../../attention/rules/rule-context.service';
import { TenantStatusService } from '../../schools/tenant-status.service';
import type {
  AnnouncementDto,
  AnnouncementListDto,
  AnnouncementPreviewDto,
  SendAnnouncementDto,
} from './dto/platform-announcements.dto';

/** The in-app banner stays this many days (a school's own alerts allow up to 30). */
const BANNER_DAYS = 3;
const ADMIN_ROLE = 'ADMIN';

interface Admin {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * [Epic 99 D5, D9, D16, D33] One message to the admins of every school in a status filter, sent
 * by a platform owner. The route is gated by two-owner approval and an Idempotency-Key; this
 * class also claims the key in the DB, so a replay never sends twice even when Redis is down.
 *
 * ```mermaid
 * flowchart LR
 *   A[claim row by key] --> B[per school: alert + SMS/email to its admins]
 *   B --> C[row counts + audit, one transaction]
 * ```
 *
 * ponytail: a crash between the claim and the end leaves a row with 0 succeeded; a retry with the
 * same key then returns that row and sends nothing (once beats twice). Resend needs a new key.
 */
@Injectable()
export class PlatformAnnouncementsService {
  private readonly logger = new Logger(PlatformAnnouncementsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly manual: ManualAlertsService,
    private readonly delivery: AccountAccessDeliveryService,
    private readonly tenantStatus: TenantStatusService,
    private readonly audit: AuditService,
  ) {}

  /** Counts only, writes nothing. */
  async preview(statusFilter: SchoolStatus[]): Promise<AnnouncementPreviewDto> {
    const admins = await this.adminsBySchool(statusFilter);
    return {
      schools: admins.size,
      people: new Set([...admins.values()].flat().map((a) => a.id)).size,
    };
  }

  async send(
    actorId: string,
    dto: SendAnnouncementDto,
    idempotencyKey: string,
  ): Promise<AnnouncementDto> {
    const bySchool = await this.adminsBySchool(dto.statusFilter);
    const claimed: { id: string }[] = await this.dataSource.query(
      `INSERT INTO platform_announcements
         (created_by, title, body, status_filter, channels, recipient_count, idempotency_key)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 0, $6)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [
        actorId,
        dto.title,
        dto.body,
        JSON.stringify({ statuses: dto.statusFilter }),
        JSON.stringify({
          sms: dto.sms,
          email: dto.email,
          severity: dto.severity,
          schoolsTargeted: bySchool.size,
          schoolsSucceeded: 0,
        }),
        idempotencyKey,
      ],
    );
    if (!claimed.length) {
      // A repeat of the same send: answer with what it did, send nothing.
      const [existing] = await this.fetch(null, idempotencyKey, 1, 0);
      // Fixed text, key not echoed (Rule 23). Another owner's key is not ours to replay.
      if (!existing || existing.createdBy !== actorId)
        throw new ConflictException('This request key was already used.');
      return existing.dto;
    }
    const id = claimed[0].id;

    const expiresOn = addDaysIso(new Date().toISOString().slice(0, 10), BANNER_DAYS);
    let schoolsSucceeded = 0;
    let recipientCount = 0;
    // An admin of several schools gets one SMS/email, not one per school (the banner is per school).
    const messaged = new Set<string>();
    for (const [tenantId, admins] of bySchool) {
      try {
        await this.manual.sendPlatform(tenantId, actorId, {
          severity: dto.severity,
          title: dto.title,
          body: dto.body,
          audience: { userIds: admins.map((a) => a.id) },
          expiresOn,
        });
      } catch (err) {
        // Class only, never the text: an error can echo the message body.
        this.logger.warn(`Announcement banner failed for a school: ${(err as Error).name}`);
        continue;
      }
      schoolsSucceeded++;
      recipientCount += admins.length;
      const fresh = admins.filter((a) => !messaged.has(a.id));
      fresh.forEach((a) => messaged.add(a.id));
      await this.deliverToAdmins(fresh, dto);
    }

    await this.dataSource.transaction(async (em) => {
      await em.query(
        `UPDATE platform_announcements
            SET recipient_count = $2,
                channels = channels || jsonb_build_object('schoolsSucceeded', $3::int)
          WHERE id = $1`,
        [id, recipientCount, schoolsSucceeded],
      );
      // Never fails open. `approved_by` is the sending owner: the guard consumed the other
      // owner's grant and keeps that link in its own approval row.
      await this.audit.recordApproved(
        {
          action: AuditAction.PLATFORM_ANNOUNCEMENT_SENT,
          entity_type: 'PlatformAnnouncement',
          entity_id: id,
          tenant_id: null,
          performed_by_user_id: actorId,
          approved_by_user_id: actorId,
          approval_scope: ApprovalScope.PLATFORM_ANNOUNCE_ALL,
          // body text is not audited
          new_values: {
            title: dto.title,
            severity: dto.severity,
            statusFilter: dto.statusFilter,
            sms: dto.sms,
            email: dto.email,
            schoolsTargeted: bySchool.size,
            schoolsSucceeded,
            recipientCount,
          },
        },
        em,
      );
    });
    const [done] = await this.fetch(id, null, 1, 0);
    return done.dto;
  }

  async list(limit = 25, offset = 0): Promise<AnnouncementListDto> {
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM platform_announcements`,
    );
    const rows = await this.fetch(null, null, Math.min(limit, 100), offset);
    return { items: rows.map((r) => r.dto), total };
  }

  /** SMS and email per admin. One failure is logged and the rest go on. */
  private async deliverToAdmins(admins: Admin[], dto: SendAnnouncementDto): Promise<void> {
    for (const a of admins) {
      const send = async (
        medium: typeof CommunicationMedium.SMS | typeof CommunicationMedium.EMAIL,
        to: string | null,
      ) => {
        if (!to) return;
        try {
          const r = await this.delivery.deliver({
            tenantId: null,
            medium,
            to,
            recipientName: a.name,
            kind: 'PLATFORM_ANNOUNCEMENT',
            vars: { title: dto.title, message: dto.body },
          });
          if (r?.status === 'FAILED') this.logger.warn(`Announcement ${medium} delivery failed`);
        } catch (err) {
          this.logger.warn(`Announcement ${medium} failed: ${(err as Error).name}`);
        }
      };
      if (dto.sms) await send(CommunicationMedium.SMS, a.phone);
      if (dto.email) await send(CommunicationMedium.EMAIL, a.email);
    }
  }

  /**
   * ACTIVE admins of every non-deleted school in the filter, platform school(s) excluded.
   * Only schools with at least one admin appear; each admin is tied to that school's membership.
   */
  private async adminsBySchool(statuses: SchoolStatus[]): Promise<Map<string, Admin[]>> {
    const skip = await this.tenantStatus.platformSchoolIds();
    const rows: { tenant_id: string; id: string; name: string; email: string; phone: string }[] =
      await this.dataSource.query(
        `SELECT ut.tenant_id, u.id, u.full_name AS name, u.email, u.phone
           FROM schools s
           JOIN user_tenants ut ON ut.tenant_id = s.id AND ut.deleted_at IS NULL
                               AND ut.role::text = $3
           JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
          WHERE s.deleted_at IS NULL AND s.status = ANY($1::text[]) AND s.id <> ALL($2::uuid[])
          ORDER BY ut.tenant_id, u.id`,
        [statuses, skip, ADMIN_ROLE],
      );
    const out = new Map<string, Admin[]>();
    for (const r of rows) {
      const list = out.get(r.tenant_id) ?? [];
      list.push({ id: r.id, name: r.name, email: r.email, phone: r.phone });
      out.set(r.tenant_id, list);
    }
    return out;
  }

  private async fetch(id: string | null, key: string | null, limit: number, offset: number) {
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT a.id, a.title, a.status_filter, a.channels, a.recipient_count, a.created_by,
              a.created_at, u.full_name AS created_by_name
         FROM platform_announcements a
         LEFT JOIN users u ON u.id = a.created_by
        WHERE ($1::uuid IS NULL OR a.id = $1) AND ($2::text IS NULL OR a.idempotency_key = $2)
        ORDER BY a.created_at DESC, a.id
        LIMIT $3 OFFSET $4`,
      [id, key, limit, offset],
    );
    return rows.map((r) => ({
      createdBy: r.created_by as string,
      dto: {
        id: r.id,
        title: r.title,
        severity: r.channels?.severity ?? AlertSeverity.WARNING,
        statusFilter: r.status_filter?.statuses ?? [],
        sms: !!r.channels?.sms,
        email: !!r.channels?.email,
        schoolsTargeted: r.channels?.schoolsTargeted ?? 0,
        schoolsSucceeded: r.channels?.schoolsSucceeded ?? 0,
        recipientCount: r.recipient_count,
        createdByName: r.created_by_name,
        createdAt: new Date(r.created_at).toISOString(),
      } satisfies AnnouncementDto,
    }));
  }
}
