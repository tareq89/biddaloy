import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { clearTransactionalTables } from '@test/setup';
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
import { createContext, type DemoSeedContext } from '../context';
import { slice as org } from './org';
import { slice as students } from './students';
import { slice as extras } from './student-extras';
import { slice as admission } from './admission';
import { slice as legal } from './legal';
import { ADMIN_REQUIRED_DOCS, LEGAL_DOCS } from '@biddaloy/shared';
import { LegalService } from '../../../modules/legal/legal.service';
import { StudentService } from '../../../modules/students/students.service';

const ANCHOR = '2026-10-10';

describe('legal slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  /** What the slice wrote, as plain numbers, so two runs can be compared. */
  const readResult = async () => ({
    pendingByAdmin: await q(
      `SELECT user_id, tenant_id, count(*)::int AS n FROM legal_acceptances GROUP BY 1, 2 ORDER BY 1, 2`,
    ),
    versions: await q(`SELECT DISTINCT document, version FROM legal_acceptances ORDER BY 1`),
    consent: await q(
      `SELECT photo_consent, count(*)::int AS n FROM students GROUP BY 1 ORDER BY 1`,
    ),
    refused: await q(
      `SELECT registration_number, photo_key, photo_consent_recorded_at FROM students
        WHERE photo_consent = 'REFUSED' ORDER BY registration_number`,
    ),
    applicants: await q(
      `SELECT photo_consent, count(*)::int AS n FROM admission_applicants GROUP BY 1 ORDER BY 1`,
    ),
    // Which applicants, not just how many: the pick must not depend on random ids.
    refusedApplicants: await q(
      `SELECT reference_number FROM admission_applicants WHERE photo_consent = 'REFUSED' ORDER BY 1`,
    ),
    adminPending: [] as string[],
  });

  /** A fresh demo school every time: the slices only target an empty database. */
  const seedAll = async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    const ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    for (const s of [org, students, extras, admission, legal]) await s.run(ctx);
    const result = await readResult();
    const legalService = app.get(LegalService);
    const adminId = (ctx.ids.get('org') as { adminUserId: string }).adminUserId;
    const tenants = await q<{ tenant_id: string }>(
      `SELECT tenant_id FROM user_tenants WHERE user_id = $1`,
      [adminId],
    );
    for (const t of tenants) {
      result.adminPending.push(...(await legalService.pending(adminId, t.tenant_id, 'ADMIN')));
    }
    result.adminPending.push(`branches:${tenants.length}`);
    result.adminPending.push(`expected:${(ctx.ids.get('org') as any).tenants.length}`);
    return result;
  };

  // The suite empties tables before each `it`, so both runs happen once here.
  const runs: Awaited<ReturnType<typeof seedAll>>[] = [];

  beforeAll(async () => {
    const module: TestingModule = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      YearRolloverService,
      FeeStructureService,
      GradingService,
      AcademicTermsService,
      PresetRegistryService,
      AuditService,
      LegalService,
      StudentService,
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
    runs.push(await seedAll());
    await clearTransactionalTables(); // audit rows block deleting schools, so reset like beforeEach
    runs.push(await seedAll()); // same anchor, same rng seed: the second run must match the first
  }, 900_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('the demo admin has nothing pending in any branch, at the current versions', () => {
    const [first] = runs;
    // Only the branch marker is left: no document is owed in any of the three branches.
    expect(first.adminPending).toEqual(['branches:3', 'expected:3']);
    expect(first.versions).toEqual(
      ADMIN_REQUIRED_DOCS.map((d) => ({ document: d, version: LEGAL_DOCS[d].version })).sort((a, b) =>
        a.document.localeCompare(b.document),
      ),
    );
    expect(first.pendingByAdmin).toHaveLength(3);
    for (const row of first.pendingByAdmin) expect(row.n).toBe(ADMIN_REQUIRED_DOCS.length);
  });

  it('student consent falls in the expected bands', () => {
    const count = (c: string) => runs[0].consent.find((r: any) => r.photo_consent === c)?.n ?? 0;
    const total = count('GIVEN') + count('REFUSED') + count('UNKNOWN');
    expect(total).toBeGreaterThan(0);
    expect(count('GIVEN') / total).toBeGreaterThan(0.85); // about 95%
    expect(count('REFUSED')).toBeGreaterThanOrEqual(1); // a few, never none
    expect(count('REFUSED') / total).toBeLessThan(0.1);
  });

  it('a REFUSED student has no photo and a recorded date', () => {
    expect(runs[0].refused.length).toBeGreaterThan(0);
    for (const s of runs[0].refused) {
      expect(s.photo_key).toBeNull();
      expect(s.photo_consent_recorded_at).not.toBeNull();
    }
  });

  it('applicants are a mix of GIVEN and REFUSED', () => {
    const kinds = runs[0].applicants.map((r: any) => r.photo_consent);
    expect(kinds).toContain('GIVEN');
    expect(kinds).toContain('REFUSED');
  });

  it('is deterministic for the same rng seed', () => {
    expect(runs[1].consent).toEqual(runs[0].consent);
    expect(runs[1].applicants).toEqual(runs[0].applicants);
    expect(runs[1].refusedApplicants).toEqual(runs[0].refusedApplicants);
    expect(runs[1].refused.map((r: any) => r.registration_number)).toEqual(
      runs[0].refused.map((r: any) => r.registration_number),
    );
  });
});
