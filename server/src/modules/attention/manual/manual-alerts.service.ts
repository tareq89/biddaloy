import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditAction, UserRole } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { AlertWriterService, lockRule, run } from '../engine/alert-writer.service';
import { RuleContextService, addDaysIso, endOfLocalDay } from '../rules/rule-context.service';
import {
  CreateManualAlertDto,
  ManualAlertDto,
  ManualAlertListDto,
  ManualAlertPreviewDto,
  ManualAudienceDto,
} from './dto/manual-alert.dto';

/** Per-tenant cap on manual sends in any rolling 24 hours (D27). */
export const MANUAL_DAILY_CAP = 20;
const MAX_DAYS_AHEAD = 30;

/**
 * [67.5.01] Manual alerts: ADMIN/EXECUTIVE send a WARNING or REMINDER to a chosen audience.
 * Stored in `alerts` / `alert_recipients` like rule alerts; every query carries `tenant_id`.
 */
@Injectable()
export class ManualAlertsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly writer: AlertWriterService,
    private readonly ruleContext: RuleContextService,
    private readonly audit: AuditService,
  ) {}

  async preview(tenantId: string, audience: ManualAudienceDto): Promise<ManualAlertPreviewDto> {
    return { recipientCount: (await this.resolveRecipientUserIds(tenantId, audience)).length };
  }

  async send(
    tenantId: string,
    actorUserId: string,
    dto: CreateManualAlertDto,
  ): Promise<ManualAlertDto> {
    const now = new Date();
    const ctx = await this.ruleContext.build(tenantId, now, actorUserId);
    if (dto.expiresOn < ctx.localDate || dto.expiresOn > addDaysIso(ctx.localDate, MAX_DAYS_AHEAD))
      throw new BadRequestException({
        message: `Pick an end date between today and ${MAX_DAYS_AHEAD} days from today`,
        details: { code: 'MANUAL_EXPIRES_RANGE' },
      });

    const userIds = await this.resolveRecipientUserIds(tenantId, dto.audience);
    if (!userIds.length)
      throw new BadRequestException({
        message: 'No one matches this audience',
        details: { code: 'MANUAL_NO_RECIPIENTS' },
      });

    const id = await this.writer.writeManual(
      tenantId,
      {
        severity: dto.severity,
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        actionUrl: dto.actionUrl,
        createdByUserId: actorUserId,
        expiresAt: endOfLocalDay(dto.expiresOn, ctx.tz),
        userIds,
      },
      // runs under the tenant's manual lock, so two parallel sends can't both pass the cap
      async (em) => {
        const [{ n }] = await run(
          em,
          `SELECT count(*)::int AS n FROM alerts
            WHERE tenant_id = $1 AND source = 'MANUAL' AND raised_at > now() - interval '24 hours'`,
          [tenantId],
        );
        if (n >= MANUAL_DAILY_CAP)
          // `details.code` tells this apart from the per-minute throttler's own 429
          throw new HttpException(
            {
              message: `Daily limit of ${MANUAL_DAILY_CAP} alerts reached`,
              details: { code: 'MANUAL_DAILY_LIMIT', limit: MANUAL_DAILY_CAP },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
      },
    );

    await this.audit.record({
      action: AuditAction.CREATE,
      entity_type: 'Alert',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      // body text is not audited
      new_values: {
        severity: dto.severity,
        title: dto.title,
        audience: dto.audience,
        recipientCount: userIds.length,
      },
    });
    return this.getOne(tenantId, id);
  }

  async list(tenantId: string, page = 1, pageSize = 25): Promise<ManualAlertListDto> {
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM alerts WHERE tenant_id = $1 AND source = 'MANUAL'`,
      [tenantId],
    );
    const items = await this.fetch(tenantId, null, pageSize, (page - 1) * pageSize);
    return { items, total };
  }

  async withdraw(tenantId: string, actorUserId: string, id: string): Promise<void> {
    const users: string[] = [];
    await this.dataSource.transaction(async (em) => {
      // same lock as the expiry sweep: they can't both close the row
      await lockRule(em, tenantId, 'manual.alert');
      const closed = await run(
        em,
        `UPDATE alerts SET status = 'WITHDRAWN', resolved_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND source = 'MANUAL' AND status = 'ACTIVE' RETURNING id`,
        [tenantId, id],
      );
      if (!closed.length) throw new NotFoundException('Alert not found');
      const rows = await run(
        em,
        `UPDATE alert_recipients SET state = 'EXPIRED', resolved_at = now(), updated_at = now()
          WHERE tenant_id = $1 AND alert_id = $2 AND state IN ('OPEN','HIDDEN') RETURNING user_id`,
        [tenantId, id],
      );
      rows.forEach((r) => users.push(r.user_id));
    });
    await this.writer.invalidateSummary(tenantId, users);
    await this.audit.record({
      action: AuditAction.DELETE,
      entity_type: 'Alert',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
    });
  }

  private async getOne(tenantId: string, id: string): Promise<ManualAlertDto> {
    const [item] = await this.fetch(tenantId, id, 1, 0);
    return item;
  }

  private async fetch(
    tenantId: string,
    id: string | null,
    limit: number,
    offset: number,
  ): Promise<ManualAlertDto[]> {
    const rows = await this.dataSource.query(
      `SELECT a.id, a.severity, a.manual_title, a.manual_body, a.action_url, a.manual_audience,
              a.raised_at, a.expires_at, a.status, u.full_name AS created_by_name,
              count(r.id)::int AS recipient_count,
              (count(r.id) FILTER (WHERE r.seen_at IS NOT NULL))::int AS seen_count
         FROM alerts a
         LEFT JOIN users u ON u.id = a.created_by_user_id
         LEFT JOIN alert_recipients r ON r.alert_id = a.id AND r.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.source = 'MANUAL' AND ($2::uuid IS NULL OR a.id = $2)
        GROUP BY a.id, u.full_name
        ORDER BY a.raised_at DESC, a.id
        LIMIT $3 OFFSET $4`,
      [tenantId, id, limit, offset],
    );
    return rows.map((r: Record<string, any>) => ({
      id: r.id,
      severity: r.severity,
      title: r.manual_title,
      body: r.manual_body,
      actionUrl: r.action_url,
      audience: r.manual_audience ?? {},
      raisedAt: new Date(r.raised_at).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      status: r.status,
      createdByName: r.created_by_name,
      recipientCount: r.recipient_count,
      seenCount: r.seen_count,
    }));
  }

  /** One set-based query (D7). Every branch is tenant-filtered; only ACTIVE members of ACTIVE users. */
  private async resolveRecipientUserIds(
    tenantId: string,
    audience: ManualAudienceDto,
  ): Promise<string[]> {
    const roles = audience.roles ?? [];
    if (roles.includes(UserRole.SUPER_ADMIN))
      throw new BadRequestException('SUPER_ADMIN cannot be an audience');
    const sections = audience.sectionIds ?? [];
    const guardianSections = audience.guardiansOfSectionIds ?? [];
    const users = audience.userIds ?? [];
    if (!roles.length && !sections.length && !guardianSections.length && !users.length)
      throw new BadRequestException('Pick at least one group');

    const rows: { user_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT x.user_id FROM (
         SELECT ut.user_id FROM user_tenants ut
          WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])
         UNION SELECT s.user_id FROM students s
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.user_id IS NOT NULL
            AND s.enrollment_status = 'ACTIVE' AND s.class_section_id = ANY($3::uuid[])
         UNION SELECT g.user_id FROM students s
           JOIN student_guardians sg ON sg.student_id = s.id
           JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
          WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.enrollment_status = 'ACTIVE'
            AND s.class_section_id = ANY($4::uuid[]) AND g.user_id IS NOT NULL
         UNION SELECT unnest($5::uuid[])
       ) x
       JOIN users u ON u.id = x.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
       WHERE EXISTS (SELECT 1 FROM user_tenants m
                      WHERE m.user_id = x.user_id AND m.tenant_id = $1 AND m.deleted_at IS NULL)`,
      [tenantId, roles, sections, guardianSections, users],
    );
    return rows.map((r) => r.user_id);
  }
}
