import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { alertRuleMeta, UserRole } from '@biddaloy/shared';
import { localDate } from '../../../attendance/attendance-policy.util';
import { SchoolsService } from '../../../schools/schools.service';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';

/** A backup older than this many days counts as missed for the schedule. */
export const BACKUP_STALE_DAYS = { DAILY: 2, WEEKLY: 8 } as const;

/** Pure: shared with the platform-wide backup rule (67.4.06). */
export function isBackupUnhealthy(
  i: {
    schedule: 'OFF' | 'DAILY' | 'WEEKLY';
    lastStatus: string | null;
    lastSuccessAt: Date | null;
    schoolCreatedAt: Date;
  },
  now: Date,
): boolean {
  if (i.schedule === 'OFF') return false;
  if (i.lastStatus === 'FAILED') return true;
  const cutoff = now.getTime() - BACKUP_STALE_DAYS[i.schedule] * 86_400_000;
  return (i.lastSuccessAt ?? i.schoolCreatedAt).getTime() < cutoff;
}

@AttentionRule()
export class SystemBackupFailedRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('system.backup_failed');
  readonly messages = {
    en: {
      title: 'School backup is failing',
      why: 'The last scheduled backup failed or is too old (last good backup: {lastSuccess}). If data is lost now it cannot be restored.',
      steps: [
        'Open Settings › Backup.',
        'Run a backup now.',
        'If it fails again, contact support.',
      ],
      action: 'Open backup settings',
    },
    bn: {
      title: 'স্কুলের ব্যাকআপ হচ্ছে না',
      why: 'শেষ নির্ধারিত ব্যাকআপ ব্যর্থ হয়েছে বা অনেক পুরনো (শেষ সফল ব্যাকআপ: {lastSuccess})। এখন তথ্য হারালে ফেরত আনা যাবে না।',
      steps: [
        'সেটিংস › ব্যাকআপ খুলুন।',
        'এখনই একটি ব্যাকআপ নিন।',
        'আবার ব্যর্থ হলে সাপোর্টে যোগাযোগ করুন।',
      ],
      action: 'ব্যাকআপ সেটিংস খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    const schedule =
      (await this.schools.getResolvedSettings(ctx.tenantId)).backup?.schedule ?? 'OFF';
    if (schedule === 'OFF') return [];
    // EXPORT jobs only — the same rule as the platform backup-health endpoint.
    const [row]: {
      last_status: string | null;
      last_success_at: Date | null;
      school_created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT
         (SELECT status::text FROM workbook_jobs WHERE tenant_id = $1 AND kind = 'EXPORT' ORDER BY created_at DESC LIMIT 1) AS last_status,
         (SELECT max(finished_at) FROM workbook_jobs WHERE tenant_id = $1 AND kind = 'EXPORT' AND status = 'DONE') AS last_success_at,
         (SELECT created_at FROM schools WHERE id = $1) AS school_created_at`,
      [ctx.tenantId],
    );
    if (
      !row?.school_created_at ||
      !isBackupUnhealthy(
        {
          schedule,
          lastStatus: row.last_status,
          lastSuccessAt: row.last_success_at,
          schoolCreatedAt: row.school_created_at,
        },
        ctx.now,
      )
    )
      return [];
    const recipients = await this.admins(ctx.tenantId);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'school:' + ctx.tenantId,
        subject: { type: 'school', id: ctx.tenantId },
        params: {
          lastSuccess: row.last_success_at ? localDate(row.last_success_at, ctx.tz) : '—',
        },
        actionUrl: '/settings?section=backup',
        recipients,
      },
    ];
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
