import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { alertRuleMeta } from '@biddaloy/shared';
import { AttentionRule } from '../attention-rule.decorator';
import type { AttentionRule as AttentionRuleShape, RuleContext, RuleFinding } from '../rule.types';
import { resolveTenantSettings } from '../../../schools/settings/tenant-settings-resolver';
import { isBackupUnhealthy } from '../system/system-backup-failed.rule';
import { PlatformTenantResolver, platformRecipients, schoolNames } from './platform-tenant';

@AttentionRule()
export class PlatformBackupFailingRule implements AttentionRuleShape {
  readonly meta = alertRuleMeta('platform.backup_failing');
  readonly messages = {
    en: {
      title: 'Backups failing in {count} schools',
      why: 'Their last scheduled backup failed or is too old: {schools}.',
      steps: [
        'Open Schools and check the backup health table.',
        'Run a backup for each school, or contact its admin.',
      ],
      action: 'Open schools',
    },
    bn: {
      title: '{count}টি স্কুলের ব্যাকআপ হচ্ছে না',
      why: 'শেষ নির্ধারিত ব্যাকআপ ব্যর্থ বা অনেক পুরনো: {schools}।',
      steps: [
        'স্কুল তালিকা খুলে ব্যাকআপের অবস্থা দেখুন।',
        'প্রতিটি স্কুলের ব্যাকআপ নিন, বা সেই স্কুলের অ্যাডমিনের সাথে যোগাযোগ করুন।',
      ],
      action: 'স্কুল তালিকা খুলুন',
    },
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly platform: PlatformTenantResolver,
  ) {}

  async evaluate(ctx: RuleContext): Promise<RuleFinding[]> {
    // The sweep visits every school; only the platform tenant's run produces findings.
    const pid = await this.platform.resolve();
    if (!pid || ctx.tenantId !== pid) return [];
    // Cross-school read on purpose (like GET /platform/backups/health); only names/counts leave.
    const rows: {
      name: string;
      settings: Record<string, unknown> | null;
      created_at: Date;
      last_status: string | null;
      last_success_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT s.name, s.settings, s.created_at,
         (SELECT j.status::text FROM workbook_jobs j WHERE j.tenant_id = s.id AND j.kind = 'EXPORT' ORDER BY j.created_at DESC LIMIT 1) AS last_status,
         (SELECT max(j.finished_at) FROM workbook_jobs j WHERE j.tenant_id = s.id AND j.kind = 'EXPORT' AND j.status = 'DONE') AS last_success_at
       FROM schools s WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL
       ORDER BY s.name`,
    );
    const bad = rows.filter((r) =>
      isBackupUnhealthy(
        {
          schedule: resolveTenantSettings(r.settings).backup?.schedule ?? 'OFF',
          lastStatus: r.last_status,
          lastSuccessAt: r.last_success_at,
          schoolCreatedAt: r.created_at,
        },
        ctx.now,
      ),
    );
    if (!bad.length) return [];
    const recipients = await platformRecipients(this.dataSource, pid);
    if (!recipients.length) return [];
    return [
      {
        dedupeKey: 'platform:backups',
        params: { count: bad.length, schools: schoolNames(bad.map((r) => r.name)) },
        actionUrl: '/schools',
        recipients,
      },
    ];
  }
}
