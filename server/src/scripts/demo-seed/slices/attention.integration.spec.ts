import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { AlertCadence } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';
import { TENANT_STATUS_REDIS } from '../../../modules/schools/tenant-status.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { AccessTokenDenylistService } from '../../../modules/auth/access-token-denylist.service';
import { SessionCutoffService } from '../../../modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../../../modules/auth/refresh-token.service';
import { ACCESS_TOKEN_TTL_MS } from '../../../modules/auth/auth-tokens';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { FamilyAccessService } from '../../../modules/students/family-access.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { SchoolCalendarService } from '../../../modules/calendar/school-calendar.service';
import { AlertWriterService } from '../../../modules/attention/engine/alert-writer.service';
import { AttentionScheduler } from '../../../modules/attention/engine/attention-scheduler';
import { ManualAlertsService } from '../../../modules/attention/manual/manual-alerts.service';
import { RuleContextService } from '../../../modules/attention/rules/rule-context.service';
import { AttendanceNotTakenRule } from '../../../modules/attention/rules/attendance/attendance-not-taken.rule';
import { HomeworkNotSubmittedRule } from '../../../modules/attention/rules/homework/homework-not-submitted.rule';
import { FeesOverdueRisingRule } from '../../../modules/attention/rules/fees/fees-overdue-rising.rule';
import { ExamsMarksOverdueRule } from '../../../modules/attention/rules/exams/exams-marks-overdue.rule';
import { AdmissionApplicationsPendingRule } from '../../../modules/attention/rules/office/admission-applications-pending.rule';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice } from './attention';

const ANCHOR = '2026-10-10';
const SCALE = 0.05;
const YEARS = 2;

/**
 * The sweeps are stubbed here: the rules need every other slice's data. The coverage spec runs the
 * real engine over the full seed and checks that each demo card gets 3+ open alerts.
 */
describe('attention slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;
  let redis: Redis;
  const sweepTenant = vi.fn();
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module: TestingModule = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      UserService,
      TeacherService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => resolveTenantSettings(null) },
      },
      { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
      { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
      { provide: AccessTokenDenylistService, useValue: { revokeUserTokensIssuedBefore: vi.fn() } },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: RefreshTokenService, useValue: {} },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      {
        provide: StorageService,
        useValue: { put: async () => undefined, delete: async () => undefined },
      },
      SchoolCalendarService,
      FamilyAccessService,
      { provide: TENANT_STATUS_REDIS, useValue: redis },
      AlertWriterService,
      RuleContextService,
      ManualAlertsService,
      { provide: AttentionScheduler, useValue: { sweepTenant } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    ctx = await createContext({
      ds,
      app: module,
      scale: SCALE,
      years: YEARS,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
  }, 120_000);

  // The suite empties data tables before every `it`, so the slices run here and one `it` reads.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    sweepTenant.mockReset();
    ctx.ids.clear();
    await org.run(ctx);
    await staff.run(ctx);
    await students.run(ctx);
    await slice.run(ctx);
  }, 900_000);

  afterAll(async () => {
    redis?.disconnect();
    if (ds) await ds.destroy();
  });

  it('writes a month of resolved history, manual alerts to the right roles, and sweeps every branch', async () => {
    // History: only resolved or expired rows, from the first day of last month up to yesterday.
    const history = await q(
      `SELECT status, raised_at, params->>'sectionId' AS section, resolved_at, expires_at
         FROM alerts WHERE source = 'RULE'`,
    );
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((a) => a.status === 'RESOLVED' || a.status === 'EXPIRED')).toBe(true);
    expect(history.some((a) => a.status === 'RESOLVED')).toBe(true);
    expect(history.some((a) => a.status === 'EXPIRED')).toBe(true);
    const raised = history.map((a) => (a.raised_at as Date).toISOString().slice(0, 10));
    // The anchor is 2026-10-10 (Dhaka), so the alerts report's "previous month" is September.
    const lastMonth = raised.filter((d) => d.startsWith('2026-09'));
    expect(lastMonth.length).toBeGreaterThan(0);
    expect(raised.every((d) => d < ANCHOR)).toBe(true);
    // Several sections, so the report's per-section table is not one row.
    expect(new Set(history.map((a) => a.section)).size).toBeGreaterThan(1);
    // A resolved alert was cleared 10 to 90 minutes after it was raised.
    for (const a of history.filter((x) => x.status === 'RESOLVED')) {
      const mins = ((a.resolved_at as Date).getTime() - (a.raised_at as Date).getTime()) / 60_000;
      expect(mins).toBeGreaterThanOrEqual(10);
      expect(mins).toBeLessThanOrEqual(90);
    }

    // Every history recipient holds a role the rule is meant for, in the alert's own branch.
    const strays = await q(
      `SELECT count(*)::int AS n FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id
        WHERE a.source = 'RULE' AND NOT EXISTS (
          SELECT 1 FROM user_tenants ut
           WHERE ut.user_id = r.user_id AND ut.tenant_id = a.tenant_id AND ut.role::text = r.role)`,
    );
    expect(strays[0].n).toBe(0);

    // Every {placeholder} in a history rule's messages is filled by the alert's params, so a title
    // never shows a raw "{count}". The rules are only read for their message templates here.
    const messagesOf: Record<string, unknown> = Object.fromEntries(
      [
        AttendanceNotTakenRule,
        HomeworkNotSubmittedRule,
        FeesOverdueRisingRule,
        ExamsMarksOverdueRule,
        AdmissionApplicationsPendingRule,
      ].map((R) => {
        const rule = new (
          R as new (...a: unknown[]) => { meta: { key: string }; messages: unknown }
        )();
        return [rule.meta.key, rule.messages];
      }),
    );
    const withParams = await q<{ rule_key: string; params: Record<string, unknown> }>(
      `SELECT DISTINCT ON (rule_key) rule_key, params FROM alerts WHERE source = 'RULE' ORDER BY rule_key`,
    );
    expect(withParams.length).toBeGreaterThan(1);
    for (const a of withParams) {
      expect(messagesOf[a.rule_key], `no message templates for ${a.rule_key}`).toBeDefined();
      const wanted = [...JSON.stringify(messagesOf[a.rule_key]).matchAll(/\{(\w+)\}/g)].map(
        (m) => m[1],
      );
      expect(
        wanted.filter((k) => !(k in a.params)),
        `${a.rule_key} params miss these placeholders`,
      ).toEqual([]);
    }

    // Manual alerts: sent by the principal and the admin, OPEN for the roles they name.
    const manual = await q(
      `SELECT manual_title, created_by_user_id FROM alerts WHERE source = 'MANUAL'`,
    );
    expect(manual).toHaveLength(4);
    const teacher = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const accountant = DEMO_CARDS.find((c) => c.key === 'accountant')!;
    const openManualFor = async (email: string) =>
      Number(
        (
          await q(
            `SELECT count(*) AS n FROM alert_recipients r
               JOIN alerts a ON a.id = r.alert_id AND a.source = 'MANUAL'
               JOIN users u ON u.id = r.user_id
              WHERE u.email = $1 AND r.state = 'OPEN'`,
            [email],
          )
        )[0].n,
      );
    expect(await openManualFor(teacher.email)).toBe(2);
    // The accountant is in three of the four audiences, so the card opens to 3 alerts by itself.
    expect(await openManualFor(accountant.email)).toBe(3);

    // The engine ran last: every branch got FAST, HOURLY and DAILY, at anchor-derived times.
    const branches = (await q(`SELECT id FROM schools WHERE slug LIKE 'bmsc-%'`)).length;
    expect(sweepTenant).toHaveBeenCalledTimes(branches * 3);
    const cadences = sweepTenant.mock.calls.map((c) => c[1]);
    expect(cadences.filter((c) => c === AlertCadence.FAST)).toHaveLength(branches);
    expect(cadences.filter((c) => c === AlertCadence.DAILY)).toHaveLength(branches);
    for (const call of sweepTenant.mock.calls) {
      expect((call[2] as Date).toISOString().slice(0, 10)).toBe(ANCHOR);
    }

    // The 58.1.05 checks stay clean.
    expect(await validate(ds)).toEqual([]);
  }, 120_000);
});
