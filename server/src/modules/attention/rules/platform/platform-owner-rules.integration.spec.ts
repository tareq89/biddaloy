import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { PlatformApprovalPendingRule } from './platform-approval-pending.rule';
import { PlatformRecoveryCodesLowRule } from './platform-recovery-codes-low.rule';
import { PlatformRulesModule } from './platform-rules.module';

const NOW = new Date('2026-10-10T05:00:00Z');
const KEYS = ['platform.recovery_codes_low', 'platform.approval_pending'];

describe('Platform owner rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let recovery: PlatformRecoveryCodesLowRule;
  let approval: PlatformApprovalPendingRule;
  let home: string;
  let ordinary: string;
  let a: string;
  let b: string;

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });
  const sweep = async (rule: AttentionRule, tenantId: string) =>
    writer.apply(ctx(tenantId), rule, await rule.evaluate(ctx(tenantId)));
  const recipientsOf = async (tenantId: string) =>
    (
      await ds.query(
        `SELECT DISTINCT r.user_id AS "userId" FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
          WHERE a.tenant_id = $1 AND a.rule_key = ANY($2)`,
        [tenantId, KEYS],
      )
    ).map((x: { userId: string }) => x.userId) as string[];

  const mkSchool = async (name: string, platform: boolean) =>
    (
      await ds.query(
        `INSERT INTO schools (name, slug, is_platform)
         VALUES ($1::text, $1::text || '-' || substr(gen_random_uuid()::text, 1, 8), $2) RETURNING id`,
        [name, platform],
      )
    )[0].id as string;
  const mkOwner = async (name: string) => {
    const id = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`owner-rules-${Math.random().toString(36).slice(2)}@example.com`, name],
      )
    )[0].id as string;
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [id]);
    return id;
  };
  const enrol = async (userId: string, codesLeft: number) => {
    await ds.query(
      `INSERT INTO user_mfa (user_id, secret_enc, confirmed_at) VALUES ($1, 'enc', now())`,
      [userId],
    );
    for (let i = 0; i < codesLeft; i++) {
      await ds.query(`INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [
        userId,
        `h${i}${userId.replace(/-/g, '')}`.padEnd(64, '0').slice(0, 64),
      ]);
    }
  };
  const pending = (requestedBy: string) =>
    ds.query(
      `INSERT INTO platform_approvals (scope, payload_hash, summary, requested_by, status, expires_at)
       VALUES ('platform.owner_lock', repeat('a', 64), '{}'::jsonb, $1, 'PENDING', $2)`,
      [requestedBy, new Date(NOW.getTime() + 3_600_000)],
    );

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
    recovery = module.get(PlatformRecoveryCodesLowRule);
    approval = module.get(PlatformApprovalPendingRule);
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    home = await mkSchool('Owner Rules HQ', true);
    ordinary = await mkSchool('Owner Rules Ordinary', false);
  }, 60000);

  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE rule_key = ANY($1)`, [KEYS]);
    await ds.query(`DELETE FROM platform_approvals`);
    await ds.query(
      `DELETE FROM user_recovery_codes WHERE user_id IN (SELECT user_id FROM platform_admins)`,
    );
    await ds.query(`DELETE FROM user_mfa WHERE secret_enc = 'enc'`);
    await ds.query(`DELETE FROM platform_admins`);
    a = await mkOwner('Alice Owner');
    b = await mkOwner('Bob Owner');
  });

  it('recovery_codes_low: only the owner who is low is told, on the home school', async () => {
    await enrol(a, 2); // low
    await enrol(b, 3); // fine
    await sweep(recovery, home);
    expect(await recipientsOf(home)).toEqual([a]);
  });

  it('approval_pending: only the OTHER owner is told', async () => {
    await pending(a);
    await sweep(approval, home);
    expect(await recipientsOf(home)).toEqual([b]);
  });

  it('a locked owner is not a recipient', async () => {
    await ds.query(`UPDATE platform_admins SET locked_at = now() WHERE user_id = $1`, [b]);
    await pending(a);
    await sweep(approval, home);
    expect(await recipientsOf(home)).toEqual([]);
  });

  it('an ordinary school gets nothing from either rule', async () => {
    await enrol(a, 0);
    await pending(a);
    await sweep(recovery, ordinary);
    await sweep(approval, ordinary);
    expect(await recipientsOf(ordinary)).toEqual([]);
    const rows = await ds.query(
      `SELECT 1 FROM alerts WHERE tenant_id = $1 AND rule_key = ANY($2)`,
      [ordinary, KEYS],
    );
    expect(rows).toHaveLength(0);
  });
});
