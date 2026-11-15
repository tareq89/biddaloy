import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';
import { YearRolloverService } from '../../../modules/academics/year-rollover.service';
import { FeeStructureService } from '../../../modules/fees/fees.service';
import { GradingService } from '../../../modules/grading/grading.service';
import { AcademicTermsService } from '../../../modules/calendar/academic-terms.service';
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
import { RoutineService } from '../../../modules/routines/routine.service';
import { RoutineSlotsService } from '../../../modules/routines/routine-slots.service';
import { RoutineStateService } from '../../../modules/routines/routine-state.service';
import { SubstitutionsService } from '../../../modules/routines/substitutions.service';
import { ChangeRequestsService } from '../../../modules/routines/change-requests.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { slice as org } from './org';
import { slice } from './admission';
import { ADMISSION_TEMPLATES } from '@biddaloy/shared';

const ANCHOR = '2026-10-10'; // a Saturday

describe('admission slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;

  const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  let app: TestingModule;

  beforeAll(async () => {
    const module: TestingModule = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      YearRolloverService,
      FeeStructureService,
      GradingService,
      AcademicTermsService,
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
      RoutineService,
      RoutineSlotsService,
      RoutineStateService,
      SubstitutionsService,
      ChangeRequestsService,
      { provide: TeacherBusyService, useValue: { busyAt: async () => null } },
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
      { provide: StorageService, useValue: { put: async () => undefined } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  // The slice takes about a minute and the test setup empties the tables before every `it`, so
  // the slices run here, and the single `it` below reads the result in sections.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await slice.run(ctx);
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('seeds one round per template with stages, applicants, results, a list and fee proofs', async () => {
    // Every covered table has rows.
    for (const e of slice.covers) {
      const table = ds.getMetadata(e as never).tableName;
      const [{ n }] = await q<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      expect(Number(n), table).toBeGreaterThan(0);
    }
    // One round per template, per branch, each with the template's stages in order.
    const rounds = await q<{ id: string; template_key: string }>(
      `SELECT id, template_key FROM admission_intakes`,
    );
    expect(new Set(rounds.map((r) => r.template_key))).toEqual(
      new Set(Object.keys(ADMISSION_TEMPLATES)),
    );
    for (const r of rounds) {
      const kinds = await q<{ kind: string }>(
        `SELECT kind FROM admission_stages WHERE intake_id = $1 ORDER BY position`,
        [r.id],
      );
      expect(kinds.map((k) => k.kind)).toEqual(
        ADMISSION_TEMPLATES[r.template_key as keyof typeof ADMISSION_TEMPLATES].stages.map(
          (s) => s.kind,
        ),
      );
    }
    // The first round is open on the anchor date and keeps the old shape: a section, every status.
    const open = await q(
      `SELECT id FROM admission_intakes WHERE open_date <= $1 AND close_date >= $1
         AND template_key = 'APPLY_ONLY' AND class_section_id IS NOT NULL`,
      [ANCHOR],
    );
    expect(open.length).toBeGreaterThan(0);
    const statuses = await q<{ status: string }>(
      `SELECT DISTINCT status FROM admission_applicants ORDER BY status`,
    );
    expect(statuses.map((r) => r.status)).toEqual([
      'ADMITTED',
      'PENDING',
      'REJECTED',
      'SHORTLISTED',
    ]);
    const [{ n: bare }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_applicants a WHERE a.status = 'SHORTLISTED'
          AND NOT EXISTS (SELECT 1 FROM admission_evaluations e WHERE e.applicant_id = a.id)`,
    );
    expect(Number(bare)).toBe(0);
    // Twins under one guardian phone in a round (Epic 68 LIFE-10).
    const twins = await q(
      `SELECT guardian_phone FROM admission_applicants
         GROUP BY intake_id, guardian_phone HAVING count(*) > 1`,
    );
    expect(twins.length).toBeGreaterThan(0);
    // A fee proof matches its applicant's fee state.
    const [{ n: mismatched }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_fee_proofs p JOIN admission_applicants a ON a.id = p.applicant_id
         WHERE p.state <> a.fee_state`,
    );
    expect(Number(mismatched)).toBe(0);
    // The full pipeline shows: scored results, merit + waiting list 1 with a deadline, both fee
    // states a clerk must act on (awaiting) or the guardian must fix (sent back, with a reason).
    const [{ n: scored }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_stage_results WHERE score IS NOT NULL`,
    );
    expect(Number(scored)).toBeGreaterThan(0);
    const lists = await q<{ kind: string; sequence: number; act_by_date: string | null }>(
      `SELECT kind, sequence, act_by_date::text FROM admission_lists`,
    );
    expect(lists.some((l) => l.kind === 'MERIT')).toBe(true);
    expect(lists.some((l) => l.kind === 'WAITING' && l.sequence === 1 && l.act_by_date)).toBe(true);
    const [{ n: awaiting }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_fee_proofs WHERE state = 'AWAITING'`,
    );
    expect(Number(awaiting)).toBeGreaterThan(0);
    const [{ n: sentBack }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_fee_proofs WHERE state = 'SENT_BACK' AND reason IS NOT NULL`,
    );
    expect(Number(sentBack)).toBeGreaterThan(0);
    // Waiting list 1 is active with a deadline, list 2 is pending; a lottery is drawn; a CLERK applicant exists.
    expect(lists.some((l) => l.kind === 'WAITING' && l.sequence === 1)).toBe(true);
    expect(lists.some((l) => l.kind === 'WAITING' && l.sequence === 2)).toBe(true);
    const [{ n: w1 }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_lists WHERE kind = 'WAITING' AND sequence = 1 AND active AND act_by_date IS NOT NULL`,
    );
    expect(Number(w1)).toBeGreaterThan(0);
    const [{ n: w2 }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_lists WHERE kind = 'WAITING' AND sequence = 2 AND NOT active`,
    );
    expect(Number(w2)).toBeGreaterThan(0);
    const [{ n: drawn }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_stage_results r JOIN admission_stages s ON s.id = r.stage_id
         WHERE s.kind = 'LOTTERY' AND r.score IS NOT NULL AND r.passed IS NULL`,
    );
    expect(Number(drawn)).toBeGreaterThan(0);
    const [{ n: clerk }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_applicants WHERE source = 'CLERK'`,
    );
    expect(Number(clerk)).toBeGreaterThan(0);
    const [{ n: quota }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_applicants WHERE quota_tags <> '[]'::jsonb`,
    );
    expect(Number(quota)).toBeGreaterThan(0);
    const states = await q<{ state: string }>(`SELECT DISTINCT state FROM admission_fee_proofs`);
    expect(states.map((r) => r.state).sort()).toEqual(['AWAITING', 'CONFIRMED', 'SENT_BACK']);
    // No list is longer than its round's seats.
    const [{ n: over }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM admission_lists l JOIN admission_intakes i ON i.id = l.intake_id
         WHERE (SELECT count(*) FROM admission_list_members m WHERE m.list_id = l.id) > i.seat_count`,
    );
    expect(Number(over)).toBe(0);
    // Not re-seeded here: audit_logs is append-only and blocks the school delete in one database.
    // demo-seed.coverage.integration.spec.ts compares two fresh databases, so it covers "same seed,
    // same rows".
    expect(await validate(ds)).toEqual([]);
  }, 600_000);
});
