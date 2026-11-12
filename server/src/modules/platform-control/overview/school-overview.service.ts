import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertStatus, UserStatus } from '@biddaloy/shared';
import { maskEmail, maskPhone } from '../../account-access/contact-mask.util';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { SchoolAdminsService } from '../../schools/admins/school-admins.service';
import { SchoolsService } from '../../schools/schools.service';
import type { SchoolOverviewDto } from './dto/school-overview.dto';

const AUDIT_ROWS = 10;

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  created_at: Date;
  via: boolean;
  actor_name: string | null;
};

/**
 * [Epic 99, D7] The 360 page's top block in one call. Composes the existing services (stats,
 * admins, SMS balance); only the small tenant-filtered counts below are new SQL. Each part fails
 * soft: a failed part is `null`, the rest still answer.
 */
@Injectable()
export class SchoolOverviewService {
  private readonly logger = new Logger(SchoolOverviewService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schools: SchoolsService,
    private readonly admins: SchoolAdminsService,
    private readonly sms: SmsCreditService,
    private readonly home: PlatformHomeService,
  ) {}

  private async soft<T>(part: string, schoolId: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(
        `overview part ${part} failed for ${schoolId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  async get(schoolId: string): Promise<SchoolOverviewDto> {
    const found: { id: string }[] = await this.ds.query(
      `SELECT id FROM schools WHERE id = $1 AND deleted_at IS NULL`,
      [schoolId],
    );
    // Same answer for unknown and platform-home: no echo, no hint that home exists.
    if (found.length === 0 || schoolId === (await this.home.id())) {
      throw new NotFoundException('School not found');
    }

    const [stats, admins, peopleByRole, sms, filesBytes, openAlerts, recentAudit, notesCount] =
      await Promise.all([
        this.soft('stats', schoolId, () => this.schools.getStats(schoolId)),
        this.soft('admins', schoolId, async () =>
          (await this.admins.list(schoolId)).map((a) => ({
            userId: a.user_id,
            name: a.name,
            email: a.email ? maskEmail(a.email) : null,
            phone: a.phone ? maskPhone(a.phone) : null,
            membershipStatus: a.membership_status,
          })),
        ),
        this.soft('people', schoolId, async () => {
          const rows: { role: string; count: number }[] = await this.ds.query(
            `SELECT ut.role AS role, COUNT(DISTINCT ut.user_id)::int AS count
               FROM user_tenants ut JOIN users u ON u.id = ut.user_id AND u.deleted_at IS NULL
              WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND u.status = $2
              GROUP BY ut.role ORDER BY ut.role`,
            [schoolId, UserStatus.ACTIVE],
          );
          return rows.map((r) => ({ role: r.role, count: r.count }));
        }),
        this.soft('sms', schoolId, () => this.sms.getBalance(schoolId)),
        this.soft('files', schoolId, async () => {
          // ponytail: attachments + live workbooks only; add a real storage meter if an owner asks (D41).
          const [r]: { total: string }[] = await this.ds.query(
            `SELECT (
               (SELECT COALESCE(SUM(size_bytes),0) FROM notice_attachments WHERE tenant_id = $1) +
               (SELECT COALESCE(SUM(size_bytes),0) FROM application_attachments WHERE tenant_id = $1) +
               (SELECT COALESCE(SUM(size_bytes),0) FROM workbook_jobs
                 WHERE tenant_id = $1 AND status <> 'DELETED')
             )::text AS total`,
            [schoolId],
          );
          return Number(r.total);
        }),
        this.soft('alerts', schoolId, async () => {
          const rows: { severity: string; count: number }[] = await this.ds.query(
            `SELECT severity, COUNT(*)::int AS count FROM alerts
              WHERE tenant_id = $1 AND status = $2 GROUP BY severity ORDER BY severity`,
            [schoolId, AlertStatus.ACTIVE],
          );
          return rows.map((r) => ({ severity: r.severity, count: r.count }));
        }),
        this.soft('audit', schoolId, async () => {
          const rows: AuditRow[] = await this.ds.query(
            `SELECT al.id, al.action::text AS action, al.entity_type, al.created_at,
                    (al.impersonated_by_platform_admin_id IS NOT NULL) AS via,
                    COALESCE(owner.full_name, actor.full_name) AS actor_name
               FROM audit_logs al
               LEFT JOIN users actor ON actor.id = al.performed_by_user_id
               LEFT JOIN users owner ON owner.id = al.impersonated_by_platform_admin_id
              WHERE al.tenant_id = $1
              ORDER BY al.created_at DESC, al.id DESC LIMIT ${AUDIT_ROWS}`,
            [schoolId],
          );
          return rows.map((r) => ({
            id: r.id,
            action: r.action,
            entityType: r.entity_type,
            createdAt: new Date(r.created_at).toISOString(),
            actorName: r.actor_name,
            viaLoginAs: r.via,
          }));
        }),
        this.soft('notes', schoolId, async () => {
          const [r]: { n: number }[] = await this.ds.query(
            `SELECT COUNT(*)::int AS n FROM platform_school_notes WHERE tenant_id = $1`,
            [schoolId],
          );
          return r.n;
        }),
      ]);

    return {
      schoolId,
      admins,
      peopleByRole,
      smsBalance: sms && { available: sms.available, reserved: sms.reserved },
      filesBytes,
      openAlerts,
      recentAudit,
      lastActivityAt: stats?.last_activity_at
        ? new Date(stats.last_activity_at).toISOString()
        : null,
      notesCount,
    };
  }
}
