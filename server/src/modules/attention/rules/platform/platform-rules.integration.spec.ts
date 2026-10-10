import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { PlatformBackupFailingRule } from './platform-backup-failing.rule';
import { PlatformProviderFailuresRule } from './platform-provider-failures.rule';
import { PlatformRulesModule } from './platform-rules.module';
import { PlatformTrialsEndingRule } from './platform-trials-ending.rule';

const NOW = new Date('2026-10-10T05:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEYS = ['platform.backup_failing', 'platform.trials_ending', 'platform.provider_failures'];

describe('Platform rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let backup: PlatformBackupFailingRule;
  let trials: PlatformTrialsEndingRule;
  let providers: PlatformProviderFailuresRule;
  let P: string;
  let A: string;
  let B: string;
  let superAdminP: string;
  let adminA: string;

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });
  const mkSchool = async (name: string, settings: object = {}, trialEndsAt: Date | null = null) =>
    (
      await ds.query(
        `INSERT INTO schools (name, slug, settings, trial_ends_at)
         VALUES ($1::text, $1::text || '-' || substr(gen_random_uuid()::text, 1, 8), $2::jsonb, $3) RETURNING id`,
        [name, JSON.stringify(settings), trialEndsAt],
      )
    )[0].id as string;
  const mkMember = async (tenantId: string, role: UserRole) => {
    const id = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', 'Platform Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`platform-${Math.random().toString(36).slice(2)}@example.com`],
      )
    )[0].id as string;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return id;
  };
  const exportJob = (tenantId: string, status: string, finishedAt: Date | null) =>
    ds.query(
      `INSERT INTO workbook_jobs (tenant_id, kind, status, finished_at) VALUES ($1, 'EXPORT', $2, $3)`,
      [tenantId, status, finishedAt],
    );
  const failedLogs = (tenantId: string, n: number) =>
    ds.query(
      `INSERT INTO communication_logs (medium, recipient_address, recipient_name, message_body, status, tenant_id, created_at, updated_at)
       SELECT 'SMS', '01700000000', 'x', 'x', 'FAILED', $1, $3::timestamptz, $3::timestamptz FROM generate_series(1, $2::int)`,
      [tenantId, n, new Date(NOW.getTime() - 10 * 60_000)],
    );
  const alertCount = async (tenantId: string) =>
    (
      await ds.query(
        `SELECT COUNT(*)::int AS n FROM alerts WHERE tenant_id = $1 AND rule_key = ANY($2)`,
        [tenantId, KEYS],
      )
    )[0].n as number;
  const sweep = async (rule: AttentionRule, tenantId: string) =>
    writer.apply(ctx(tenantId), rule, await rule.evaluate(ctx(tenantId)));

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
        AuthModule,
        TenantStatusModule,
        PlatformRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    backup = module.get(PlatformBackupFailingRule);
    trials = module.get(PlatformTrialsEndingRule);
    providers = module.get(PlatformProviderFailuresRule);
    P = await mkSchool('Platform HQ');
    A = await mkSchool('Alpha School', { backup: { schedule: 'DAILY' } });
    B = await mkSchool('Beta School');
    process.env.PLATFORM_TENANT_ID = P;
    superAdminP = await mkMember(P, UserRole.SUPER_ADMIN);
    adminA = await mkMember(A, UserRole.ADMIN);
  }, 60000);

  // Harness wipes some tables between tests; clear what it keeps.
  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE rule_key = ANY($1)`, [KEYS]);
    await ds.query(`DELETE FROM workbook_jobs WHERE tenant_id = ANY($1)`, [[A, B]]);
    await ds.query(`DELETE FROM communication_logs WHERE tenant_id = ANY($1)`, [[A, B]]);
    await ds.query(`UPDATE schools SET trial_ends_at = NULL WHERE id = ANY($1)`, [[A, B]]);
  });

  afterAll(async () => {
    delete process.env.PLATFORM_TENANT_ID;
    await ds.destroy();
  });

  it('backup_failing: a failing scheduled school alerts only the platform SUPER_ADMIN; resolves when fixed', async () => {
    await exportJob(A, 'FAILED', null);
    const [f] = await backup.evaluate(ctx(P));
    expect(f.params).toEqual({ count: 1, schools: 'Alpha School' });
    expect(f.recipients.map((r) => r.userId)).toEqual([superAdminP]);

    await sweep(backup, P);
    expect(
      await ds.query(
        `SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = 'platform.backup_failing'`,
        [P],
      ),
    ).toEqual([{ status: 'ACTIVE' }]);

    // A good backup now exists -> healthy -> resolved.
    await exportJob(A, 'DONE', new Date(NOW.getTime() - HOUR));
    await sweep(backup, P);
    expect(
      await ds.query(
        `SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = 'platform.backup_failing'`,
        [P],
      ),
    ).toEqual([{ status: 'RESOLVED' }]);
  });

  it('trials_ending: a trial ending in 3 days fires, in 10 days does not', async () => {
    await ds.query(`UPDATE schools SET trial_ends_at = $2 WHERE id = $1`, [
      B,
      new Date(NOW.getTime() + 3 * DAY),
    ]);
    const [f] = await trials.evaluate(ctx(P));
    expect(f.params).toEqual({ count: 1, schools: 'Beta School' });

    await ds.query(`UPDATE schools SET trial_ends_at = $2 WHERE id = $1`, [
      B,
      new Date(NOW.getTime() + 10 * DAY),
    ]);
    expect(await trials.evaluate(ctx(P))).toEqual([]);
  });

  it('provider_failures: 25 failed logs across two schools fire, 19 do not', async () => {
    await failedLogs(A, 10);
    await failedLogs(B, 9);
    expect(await providers.evaluate(ctx(P))).toEqual([]);
    await failedLogs(B, 6);
    const [f] = await providers.evaluate(ctx(P));
    expect(f.params).toEqual({ count: 25, schools: 2 });
  });

  it('never produces findings for a normal school and writes no alerts there', async () => {
    await exportJob(A, 'FAILED', null);
    await ds.query(`UPDATE schools SET trial_ends_at = $2 WHERE id = $1`, [
      B,
      new Date(NOW.getTime() + 3 * DAY),
    ]);
    await failedLogs(A, 25);
    for (const rule of [backup, trials, providers]) {
      for (const tenant of [A, B]) {
        expect(await rule.evaluate(ctx(tenant))).toEqual([]);
        await sweep(rule, tenant);
      }
    }
    // Tenant-facing users receive nothing; the school's own admin is not a recipient.
    expect(await alertCount(A)).toBe(0);
    expect(await alertCount(B)).toBe(0);
    expect(adminA).toBeTruthy();
    for (const rule of [backup, trials, providers]) await sweep(rule, P);
    expect(await alertCount(P)).toBe(3);
    const recips = await ds.query(
      `SELECT DISTINCT ar.user_id FROM alert_recipients ar JOIN alerts a ON a.id = ar.alert_id WHERE a.rule_key = ANY($1)`,
      [KEYS],
    );
    expect(recips.map((r: { user_id: string }) => r.user_id)).toEqual([superAdminP]);
  });
});
