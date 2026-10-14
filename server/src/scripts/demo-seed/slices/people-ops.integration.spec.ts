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
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice as routine } from './routine';
import { slice } from './people-ops';

const ANCHOR = '2026-10-10'; // a Saturday

describe('people-ops slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;

  const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  let app: TestingModule;

  beforeAll(async () => {
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
    await staff.run(ctx);
    await students.run(ctx);
    await routine.run(ctx);
    await slice.run(ctx);
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('seeds ACRs, surveys, incidents and an open admission intake', async () => {
    // The ACR total of a completed assessment is the sum of its scores.
    const totals = await q<{ total: number; sum: string; n: string }>(
      `SELECT a.total, sum(sc.score) AS sum, count(sc.id) AS n
         FROM acr_assessments a JOIN acr_scores sc ON sc.assessment_id = a.id
        WHERE a.status = 'COMPLETED' GROUP BY a.id, a.total`,
    );
    expect(totals.length).toBeGreaterThan(0);
    for (const row of totals) {
      expect(Number(row.sum)).toBe(row.total);
      expect(Number(row.n)).toBe(25);
    }
    // Every branch has the 25 default criteria and a teacher ACR for each of the two seeded years.
    const [{ n: perTeacherYear }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM (SELECT user_id, academic_year_id FROM acr_assessments
        GROUP BY tenant_id, user_id, academic_year_id HAVING count(*) > 1) x`,
    );
    expect(Number(perTeacherYear)).toBe(0);
    const [{ n: criteria }] = await q<{ n: string }>(`SELECT count(*) AS n FROM acr_criteria`);
    expect(Number(criteria) % 25).toBe(0);

    // The intake is open on the anchor date.
    const intakes = await q(
      `SELECT id FROM admission_intakes WHERE open_date <= $1 AND close_date >= $1`,
      [ANCHOR],
    );
    expect(intakes.length).toBeGreaterThan(0);

    // Applicants exist in every status, and every shortlisted one has an evaluation.
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
    // One pair of twins under one guardian phone per intake.
    const twins = await q(
      `SELECT guardian_phone FROM admission_applicants
        GROUP BY intake_id, guardian_phone HAVING count(*) > 1`,
    );
    expect(twins.length).toBeGreaterThan(0);

    // Surveys have responses with answers.
    const [{ n: responses }] = await q<{ n: string }>(`SELECT count(*) AS n FROM survey_responses`);
    expect(Number(responses)).toBeGreaterThan(0);
    const [{ n: answers }] = await q<{ n: string }>(`SELECT count(*) AS n FROM survey_answers`);
    expect(Number(answers)).toBeGreaterThan(0);

    // One incident per branch is withdrawn, with a reason.
    const withdrawn = await q<{ withdraw_reason: string }>(
      `SELECT withdraw_reason FROM staff_incidents WHERE withdrawn_at IS NOT NULL`,
    );
    expect(withdrawn).toHaveLength(3);
    for (const w of withdrawn) expect(w.withdraw_reason.length).toBeGreaterThan(0);
    expect(
      (await validate(ds)).filter((v) => /acr|survey|incident|admission/.test(v.check)),
    ).toEqual([]);
  }, 120_000);
});
