import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
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
import { slice } from './routine';

const ANCHOR = '2026-10-10'; // a Saturday: a school day

describe('routine slice (integration, 2 years, scale 0.2)', () => {
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
      scale: 0.2,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await slice.run(ctx);
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('writes a full, valid, published weekly routine with a substitution and a change request today', async () => {
    // Every section of the current year has a slot in every CLASS period of all 6 school days.
    const sections = await q<{ slug: string; n: string; per_day: string }>(
      `SELECT s.slug, count(rs.id) AS n,
              (SELECT count(*) FROM period_slots p WHERE p.tenant_id = s.id AND p.kind = 'CLASS') AS per_day
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id
         JOIN academic_years a ON a.id = c.academic_year_id AND a.is_current
         JOIN schools s ON s.id = cs.tenant_id AND s.slug LIKE 'bmsc-%'
         LEFT JOIN routine_slots rs ON rs.section_id = cs.id
        GROUP BY cs.id, s.id, s.slug`,
    );
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(Number(s.n), s.slug).toBe(Number(s.per_day) * 6);

    // The 58.1.05 routine check (clashes, cross-branch included) finds nothing.
    expect((await validate(ds)).filter((v) => v.check === 'routine')).toEqual([]);

    // Teacher load, D9: 3-5 periods a day (College: at least 2.5). The slice itself throws otherwise.
    const loads = await q<{ slug: string; per_day: string }>(
      `SELECT s.slug, count(*)::float / 6 AS per_day
         FROM routine_slot_teachers rst
         JOIN routine_slots rs ON rs.id = rst.routine_slot_id
         JOIN routines r ON r.id = rs.routine_id
         JOIN academic_years a ON a.id = r.academic_year_id AND a.is_current
         JOIN teachers t ON t.id = rst.teacher_id
         JOIN schools s ON s.id = t.tenant_id
        GROUP BY t.id, s.slug`,
    );
    expect(loads.length).toBeGreaterThan(0);
    // The shared ICT teacher is counted in each branch separately here, so only the cap is checked for it.
    for (const l of loads) expect(Number(l.per_day), l.slug).toBeLessThanOrEqual(5);

    // The shared ICT teacher never overlaps itself across High and College.
    const [{ n: clashes }] = await q<{ n: string }>(
      `SELECT count(*) AS n
         FROM routine_slot_teachers a
         JOIN teachers ta ON ta.id = a.teacher_id
         JOIN routine_slots sa ON sa.id = a.routine_slot_id
         JOIN period_slots pa ON pa.id = sa.period_slot_id
         JOIN teachers tb ON tb.user_id = ta.user_id AND tb.tenant_id <> ta.tenant_id
         JOIN routine_slot_teachers b ON b.teacher_id = tb.id
         JOIN routine_slots sb ON sb.id = b.routine_slot_id AND sb.weekday = sa.weekday
         JOIN period_slots pb ON pb.id = sb.period_slot_id
        WHERE pa.starts_at < pb.ends_at AND pb.starts_at < pa.ends_at`,
    );
    expect(Number(clashes)).toBe(0);

    // The older year repeats the grid: same number of slots, with an end date.
    const perYear = await q<{ is_current: boolean; n: string; ended: string }>(
      `SELECT a.is_current, count(*) AS n, count(rs.valid_to) AS ended
         FROM routine_slots rs JOIN routines r ON r.id = rs.routine_id
         JOIN academic_years a ON a.id = r.academic_year_id
         JOIN schools s ON s.id = rs.tenant_id AND s.slug = 'bmsc-high'
        GROUP BY a.is_current ORDER BY a.is_current`,
    );
    expect(perYear).toHaveLength(2);
    expect(perYear[0].n).toBe(perYear[1].n);
    expect(Number(perYear[0].ended)).toBe(Number(perYear[0].n));
    expect(Number(perYear[1].ended)).toBe(0);

    // Both years' routines are published.
    const [{ n: unpublished }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM routines r JOIN schools s ON s.id = r.tenant_id
        WHERE s.slug LIKE 'bmsc-%' AND r.state <> 'PUBLISHED'`,
    );
    expect(Number(unpublished)).toBe(0);

    // Today: one substitution dated the anchor, one open change request from the Class 8-A teacher.
    const subs = await q(
      `SELECT date::text AS date FROM routine_substitutions WHERE substitute_teacher_id IS NOT NULL`,
    );
    expect(subs).toEqual([{ date: ANCHOR }]);
    const card = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const requests = await q(
      `SELECT cr.state FROM routine_change_requests cr JOIN users u ON u.id = cr.requested_by
        WHERE u.email = $1`,
      [card.email],
    );
    expect(requests).toEqual([{ state: 'OPEN' }]);
  }, 120_000);
});
