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
import { CommsFailedMessagesRule } from './comms-failed-messages.rule';
import { CommsSmsCreditLowRule } from './comms-sms-credit-low.rule';
import { SystemBackupFailedRule } from './system-backup-failed.rule';
import { SystemRulesModule } from './system-rules.module';

const NOW = new Date('2026-10-10T05:00:00Z');

describe('System rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let credit: CommsSmsCreditLowRule;
  let failed: CommsFailedMessagesRule;
  let backup: SystemBackupFailedRule;
  let a: string;
  let b: string;
  let adminA: string;
  let adminB: string;

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });
  const mkSchool = async (name: string, settings: object) =>
    (
      await ds.query(
        `INSERT INTO schools (name, slug, settings)
         VALUES ($1::text, $1::text || '-' || substr(gen_random_uuid()::text, 1, 8), $2::jsonb) RETURNING id`,
        [name, JSON.stringify(settings)],
      )
    )[0].id as string;
  const mkAdmin = async (tenantId: string) => {
    const id = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', 'System Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`system-${Math.random().toString(36).slice(2)}@example.com`],
      )
    )[0].id as string;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, UserRole.ADMIN],
    );
    return id;
  };
  const failedLogs = (tenantId: string, n: number, updatedAt: string) =>
    ds.query(
      `INSERT INTO communication_logs (medium, recipient_address, recipient_name, message_body, status, tenant_id, created_at, updated_at)
       SELECT 'SMS', '01700000000', 'x', 'x', 'FAILED', $1, $3::timestamptz, $3::timestamptz FROM generate_series(1, $2::int)`,
      [tenantId, n, updatedAt],
    );
  const exportJob = (tenantId: string, status: string, finishedAt: string | null) =>
    ds.query(
      `INSERT INTO workbook_jobs (tenant_id, kind, status, finished_at) VALUES ($1, 'EXPORT', $2, $3)`,
      [tenantId, status, finishedAt],
    );
  const setBalance = (tenantId: string, available: number) =>
    ds.query(
      `INSERT INTO sms_credit_balance (tenant_id, available) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET available = $2`,
      [tenantId, available],
    );
  const run = async (rule: AttentionRule, tenantId: string) => {
    const c = ctx(tenantId);
    return writer.apply(c, rule, await rule.evaluate(c));
  };
  const status = async (tenantId: string, ruleKey: string) =>
    (
      await ds.query(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
        tenantId,
        ruleKey,
      ])
    ).map((r: { status: string }) => r.status);

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        // SchoolsModule reaches Bull queues and the @Global AuthModule; AppModule normally supplies both.
        BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
        AuthModule,
        TenantStatusModule,
        SystemRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    credit = module.get(CommsSmsCreditLowRule, { strict: false });
    failed = module.get(CommsFailedMessagesRule, { strict: false });
    backup = module.get(SystemBackupFailedRule, { strict: false });
    // Settings are fixed for the file (they are cached per process).
    const settings = {
      backup: { schedule: 'DAILY' },
      communications: { sms: { metering: 'PLATFORM' } },
    };
    a = await mkSchool('system-a', settings);
    b = await mkSchool('system-b', settings);
    adminA = await mkAdmin(a);
    adminB = await mkAdmin(b);
  }, 60000);

  afterAll(async () => {
    // Schools/users stay (test DB is dropped per run); child rows are removed in beforeEach.
    await ds.destroy();
  });

  beforeEach(async () => {
    const ids = [[a, b]];
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1::uuid[])`, ids);
    await ds.query(`DELETE FROM communication_logs WHERE tenant_id = ANY($1::uuid[])`, ids);
    await ds.query(`DELETE FROM workbook_jobs WHERE tenant_id = ANY($1::uuid[])`, ids);
    await ds.query(`DELETE FROM sms_credit_balance WHERE tenant_id = ANY($1::uuid[])`, ids);
  });

  it('sms_credit_low fires for a metered school under the threshold, then resolves after top-up', async () => {
    await setBalance(a, 50);
    await setBalance(b, 5000);
    expect((await run(credit, a)).created).toBe(1);
    expect(await status(a, 'comms.sms_credit_low')).toEqual(['ACTIVE']);
    expect(await credit.evaluate(ctx(b))).toEqual([]);

    await setBalance(a, 500);
    await run(credit, a);
    expect(await status(a, 'comms.sms_credit_low')).toEqual(['RESOLVED']);
  });

  it('failed_messages needs 10 failures in the last 24h, counts only its own tenant', async () => {
    await failedLogs(a, 9, '2026-10-10T04:00:00Z');
    await failedLogs(b, 50, '2026-10-10T04:00:00Z');
    expect(await failed.evaluate(ctx(a))).toEqual([]);

    await failedLogs(a, 1, '2026-10-10T04:00:00Z');
    const [f] = await failed.evaluate(ctx(a));
    expect(f.params).toEqual({ count: 10 });
    // Tenant isolation: A's finding never lists B's admin.
    expect(f.recipients.map((r) => r.userId)).toEqual([adminA]);
    expect(adminB).not.toBe(adminA);
  });

  it('failed_messages ignores failures older than 24h', async () => {
    await failedLogs(a, 10, '2026-10-08T04:00:00Z');
    expect(await failed.evaluate(ctx(a))).toEqual([]);
  });

  it('backup_failed fires on a failed last export, ignores a recent success, and resolves', async () => {
    await exportJob(a, 'FAILED', '2026-10-10T03:00:00Z');
    await exportJob(b, 'DONE', '2026-10-10T04:00:00Z'); // 1 hour ago
    expect((await run(backup, a)).created).toBe(1);
    expect(await status(a, 'system.backup_failed')).toEqual(['ACTIVE']);
    expect(await backup.evaluate(ctx(b))).toEqual([]);

    // B's failures never leak into A: a fresh DONE export for A clears A only.
    await exportJob(a, 'DONE', '2026-10-10T04:30:00Z');
    await run(backup, a);
    expect(await status(a, 'system.backup_failed')).toEqual(['RESOLVED']);
  });
});
