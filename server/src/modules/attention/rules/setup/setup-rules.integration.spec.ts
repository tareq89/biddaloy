import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { OnboardingService } from '../../../onboarding/onboarding.service';
import { SchoolsService } from '../../../schools/schools.service';
import type { TenantSettingsDto } from '../../../schools/dto/tenant-settings.dto';
import { AlertWriterService } from '../../engine/alert-writer.service';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../../engine/attention-events';
import { attentionEvents } from '../../attention.constants';
import type { AttentionRule, RuleContext } from '../rule.types';
import { SetupRulesModule } from './setup-rules.module';
import { SetupIncompleteRule } from './setup-incomplete.rule';
import { StaffInvitePendingRule } from './staff-invite-pending.rule';
import { YearNextMissingRule } from './year-next-missing.rule';

describe('Setup rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let onboarding: OnboardingService;
  let schools: SchoolsService;
  let incomplete: SetupIncompleteRule;
  let invites: StaffInvitePendingRule;
  let yearNext: YearNextMissingRule;
  let a: string;
  let b: string;
  let adminA: string;
  let adminB: string;
  let staffA: string;
  let staffB: string;
  let events: AttentionRecheckPayload[];
  const onRecheck = (p: AttentionRecheckPayload) => events.push(p);

  const ctx = (tenantId: string): RuleContext => ({
    tenantId,
    now: new Date('2026-10-10T05:00:00Z'),
    tz: 'Asia/Dhaka',
    localDate: '2026-10-10',
    localTime: '11:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
  });
  const mkSchool = async (n: string) =>
    (
      await ds.query(
        `INSERT INTO schools (name, slug) VALUES ($1::text, $1::text || '-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
        [n],
      )
    )[0].id as string;
  const mkUser = async (tenantId: string, role: UserRole, withPassword: boolean) => {
    const id = (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2::text, 'Setup Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`setup-${Math.random().toString(36).slice(2)}@example.com`, withPassword ? 'x' : null],
      )
    )[0].id as string;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return id;
  };
  const invite = (userId: string, tenantId: string, consumed = false) =>
    ds.query(
      `INSERT INTO auth_tokens (user_id, tenant_id, purpose, token_hash, expires_at, consumed_at)
       VALUES ($1, $2, 'INVITE', $3, NOW() + interval '7 days', $4)`,
      [
        userId,
        tenantId,
        Math.random().toString(36).slice(2).padEnd(32, 'x'),
        consumed ? new Date() : null,
      ],
    );
  const year = (tenantId: string, name: string, start: string, end: string, current: boolean) =>
    ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [name, start, end, current, tenantId],
    );
  const run = async (rule: AttentionRule, tenantId: string) => {
    const c = ctx(tenantId);
    return writer.apply(c, rule, await rule.evaluate(c));
  };
  const alerts = (tenantId: string, ruleKey: string) =>
    ds.query(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
      tenantId,
      ruleKey,
    ]);

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
        SetupRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    const get = <T>(t: new (...a: never[]) => T) => module.get(t, { strict: false });
    onboarding = get(OnboardingService);
    schools = get(SchoolsService);
    incomplete = get(SetupIncompleteRule);
    invites = get(StaffInvitePendingRule);
    yearNext = get(YearNextMissingRule);
    a = await mkSchool('setup-a');
    b = await mkSchool('setup-b');
    adminA = await mkUser(a, UserRole.ADMIN, true);
    adminB = await mkUser(b, UserRole.ADMIN, true);
    staffA = await mkUser(a, UserRole.TEACHER, false);
    staffB = await mkUser(b, UserRole.TEACHER, false);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`DELETE FROM auth_tokens WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    // Schools/users stay: update() and updateSettings() wrote append-only audit_logs rows that reference them.
    await ds.destroy();
  });

  beforeEach(async () => {
    events = [];
    attentionEvents.on(ATTENTION_RECHECK, onRecheck);
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`DELETE FROM auth_tokens WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id = ANY($1::uuid[])`, [[a, b]]);
    await ds.query(`UPDATE schools SET onboarding = NULL WHERE id = ANY($1::uuid[])`, [[a, b]]);
  });
  afterEach(() => attentionEvents.off(ATTENTION_RECHECK, onRecheck));

  it('setup.incomplete alerts only the tenant ADMIN of the unfinished school', async () => {
    const [f] = await incomplete.evaluate(ctx(a));
    expect(f.recipients).toEqual([{ userId: adminA, role: UserRole.ADMIN }]);
    // Finishing the wizard clears it.
    await ds.query(
      `UPDATE schools SET onboarding = '{"finished_at":"2026-10-01T00:00:00Z"}' WHERE id = $1`,
      [a],
    );
    expect(await incomplete.evaluate(ctx(a))).toEqual([]);
  });

  it('staff.invite_pending counts only this tenant, and a consumed token clears it', async () => {
    await invite(staffA, a);
    await invite(staffB, b);
    await invite(adminB, b, true);
    const [f] = await invites.evaluate(ctx(a));
    expect(f.params).toEqual({ count: 1 });
    expect(f.recipients.map((r) => r.userId)).toEqual([adminA]);

    await ds.query(`UPDATE auth_tokens SET consumed_at = NOW() WHERE tenant_id = $1`, [a]);
    expect(await invites.evaluate(ctx(a))).toEqual([]);
  });

  it('year.next_missing fires near year end, ignores other tenants, and resolves once the next year exists', async () => {
    await year(a, '2026', '2026-01-01', '2026-11-09', true); // ends in 30 days
    await year(b, '2026', '2026-01-01', '2026-11-09', true);
    await year(b, '2027', '2027-01-01', '2027-12-31', false);

    expect((await run(yearNext, a)).created).toBe(1);
    expect(await alerts(a, 'year.next_missing')).toEqual([{ status: 'ACTIVE' }]);
    // B already has its next year: nothing for B.
    expect(await yearNext.evaluate(ctx(b))).toEqual([]);

    await year(a, '2027', '2027-01-01', '2027-12-31', false);
    await run(yearNext, a);
    expect(await alerts(a, 'year.next_missing')).toEqual([{ status: 'RESOLVED' }]);
  });

  it('emits recheck events from OnboardingService.update and SchoolsService.updateSettings', async () => {
    await onboarding.update(a, adminA, { finished: true });
    expect(events).toEqual([{ tenantId: a, ruleKey: 'setup.incomplete', actorUserId: adminA }]);

    events.length = 0;
    await schools.updateSettings(
      a,
      { communications: { sms: undefined } } as TenantSettingsDto,
      adminA,
    );
    expect(events.map((e) => e.ruleKey).sort()).toEqual([
      'comms.provider_missing',
      'setup.incomplete',
    ]);

    events.length = 0;
    await schools.updateSettings(a, {} as TenantSettingsDto, adminA);
    expect(events).toEqual([]);
  });
});
